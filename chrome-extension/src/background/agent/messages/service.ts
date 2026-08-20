import { type BaseMessage, AIMessage, HumanMessage, type SystemMessage, ToolMessage } from '@langchain/core/messages';
import { MessageHistory, MessageMetadata, type ManagedMessage } from '@src/background/agent/messages/views';
import { createLogger } from '@src/background/log';
import {
  filterExternalContent,
  wrapUserRequest,
  splitUserTextAndAttachments,
  wrapAttachments,
} from '@src/background/agent/messages/utils';

const logger = createLogger('MessageManager');

export class MessageManagerSettings {
  maxInputTokens = 128000;
  // Token counts produced with this are an estimate (chars-per-token), not an exact
  // tokenizer count - good enough for a soft budget, not for billing-grade accuracy.
  estimatedCharactersPerToken = 3;
  imageTokens = 800;
  includeAttributes: string[] = [];
  messageContext?: string;
  sensitiveData?: Record<string, string>;
  availableFilePaths?: string[];
  // Rolling-window cap on how many navigator turns (state + model output + tool response)
  // are kept in history, independent of the token budget above. This bounds growth even
  // when maxInputTokens is generous (or, as today, never reaches its configured value
  // because MessageManager is constructed with no settings - see executor.ts) across the
  // up-to-100 steps a single task can run.
  maxHistoryTurns = 20;

  constructor(
    options: {
      maxInputTokens?: number;
      estimatedCharactersPerToken?: number;
      imageTokens?: number;
      includeAttributes?: string[];
      messageContext?: string;
      sensitiveData?: Record<string, string>;
      availableFilePaths?: string[];
      maxHistoryTurns?: number;
    } = {},
  ) {
    if (options.maxInputTokens !== undefined) this.maxInputTokens = options.maxInputTokens;
    if (options.estimatedCharactersPerToken !== undefined)
      this.estimatedCharactersPerToken = options.estimatedCharactersPerToken;
    if (options.imageTokens !== undefined) this.imageTokens = options.imageTokens;
    if (options.includeAttributes !== undefined) this.includeAttributes = options.includeAttributes;
    if (options.messageContext !== undefined) this.messageContext = options.messageContext;
    if (options.sensitiveData !== undefined) this.sensitiveData = options.sensitiveData;
    if (options.availableFilePaths !== undefined) this.availableFilePaths = options.availableFilePaths;
    if (options.maxHistoryTurns !== undefined) this.maxHistoryTurns = options.maxHistoryTurns;
  }
}

export default class MessageManager {
  private history: MessageHistory;
  private toolId: number;
  private settings: MessageManagerSettings;

  // Rolling-window bookkeeping (see MessageManagerSettings.maxHistoryTurns).
  // currentTurnLength counts messages added since the turn currently being built started;
  // turnLengths is a queue (oldest first) of message-counts for turns that have already
  // closed, i.e. how many messages removeOldestMessage() must pop to drop that whole turn.
  private currentTurnLength = 0;
  private turnLengths: number[] = [];
  private elidedTurns = 0;
  private truncationPlaceholder: ManagedMessage | null = null;

  constructor(settings: MessageManagerSettings = new MessageManagerSettings()) {
    this.settings = settings;
    this.history = new MessageHistory();
    this.toolId = 1;
  }

  public initTaskMessages(systemMessage: SystemMessage, task: string, messageContext?: string): void {
    // Add system message
    this.addMessageWithTokens(systemMessage, 'init');

    // Add context message if provided
    if (messageContext && messageContext.length > 0) {
      const contextMessage = new HumanMessage({
        content: `Context for the task: ${messageContext}`,
      });
      this.addMessageWithTokens(contextMessage, 'init');
    }

    // Add task instructions
    const taskMessage = MessageManager.taskInstructions(task);
    this.addMessageWithTokens(taskMessage, 'init');

    // Add sensitive data info if sensitive data is provided
    if (this.settings.sensitiveData) {
      const info = `Here are placeholders for sensitive data: ${Object.keys(this.settings.sensitiveData)}`;
      const infoMessage = new HumanMessage({
        content: `${info}\nTo use them, write <secret>the placeholder name</secret>`,
      });
      this.addMessageWithTokens(infoMessage, 'init');
    }

    // Add example output
    const placeholderMessage = new HumanMessage({
      content: 'Example output:',
    });
    this.addMessageWithTokens(placeholderMessage, 'init');

    const toolCallId = this.nextToolId();
    const toolCalls = [
      {
        name: 'AgentOutput',
        args: {
          current_state: {
            evaluation_previous_goal:
              `Success - I successfully clicked on the 'Apple' link from the Google Search results page, 
              which directed me to the 'Apple' company homepage. This is a good start toward finding 
              the best place to buy a new iPhone as the Apple website often list iPhones for sale.`.trim(),
            memory: `I searched for 'iPhone retailers' on Google. From the Google Search results page, 
              I used the 'click_element' tool to click on a element labelled 'Best Buy' but calling 
              the tool did not direct me to a new page. I then used the 'click_element' tool to click 
              on a element labelled 'Apple' which redirected me to the 'Apple' company homepage. 
              Currently at step 3/15.`.trim(),
            next_goal: `Looking at reported structure of the current page, I can see the item '[127]<h3 iPhone/>' 
              in the content. I think this button will lead to more information and potentially prices 
              for iPhones. I'll click on the link to 'iPhone' at index [127] using the 'click_element' 
              tool and hope to see prices on the next page.`.trim(),
          },
          action: [{ click_element: { index: 127 } }],
        },
        id: String(toolCallId),
        type: 'tool_call' as const,
      },
    ];

    const exampleToolCall = new AIMessage({
      content: '',
      tool_calls: toolCalls,
    });
    this.addMessageWithTokens(exampleToolCall, 'init');
    this.addToolMessage('Browser started', toolCallId, 'init');

    // Add history start marker
    const historyStartMessage = new HumanMessage({
      content: '[Your task history memory starts here]',
    });
    this.addMessageWithTokens(historyStartMessage);

    // Add available file paths if provided
    if (this.settings.availableFilePaths && this.settings.availableFilePaths.length > 0) {
      const filepathsMsg = new HumanMessage({
        content: `Here are file paths you can use: ${this.settings.availableFilePaths}`,
      });
      this.addMessageWithTokens(filepathsMsg, 'init');
    }

    // Everything seeded above (system message, task, sensitive-data note, one-shot example,
    // the history-start marker, file paths) is now sealed off as protected: the rolling
    // window below only ever drops turns added after this point.
    this.history.seedCount = this.history.messages.length;
    this.currentTurnLength = 0;
  }

  public nextToolId(): number {
    const id = this.toolId;
    this.toolId += 1;
    return id;
  }

  /**
   * Createthe task instructions
   * @param task - The raw description of the task
   * @returns A HumanMessage object containing the task instructions
   */
  private static taskInstructions(task: string): HumanMessage {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(task);

    // Filter and wrap user text
    const cleanedTask = filterExternalContent(userText);
    const content = `Your ultimate task is: """${cleanedTask}""". If you achieved your ultimate task, stop everything and use the done action in the next step to complete the task. If not, continue as usual.`;
    const wrappedUser = wrapUserRequest(content, false);

    // Filter and wrap attachments as untrusted content
    if (attachmentsInner && attachmentsInner.length > 0) {
      const wrappedFiles = wrapAttachments(attachmentsInner);
      return new HumanMessage({ content: `${wrappedUser}\n\n${wrappedFiles}` });
    }

    return new HumanMessage({ content: wrappedUser });
  }

  /**
   * Returns the number of messages in the history
   * @returns The number of messages in the history
   */
  public length(): number {
    return this.history.messages.length;
  }

  /**
   * Returns the current (estimated - see MessageManagerSettings.estimatedCharactersPerToken)
   * total token count of the history.
   */
  public getTotalTokens(): number {
    return this.history.totalTokens;
  }

  /**
   * Adds a new task to execute, it will be executed based on the history
   * @param newTask - The raw description of the new task
   */
  public addNewTask(newTask: string): void {
    const { userText, attachmentsInner } = splitUserTextAndAttachments(newTask);

    // Filter and wrap user text
    const cleanedTask = filterExternalContent(userText);
    const content = `Your new ultimate task is: """${cleanedTask}""". This is a follow-up of the previous tasks. Make sure to take all of the previous context into account and finish your new ultimate task.`;
    const wrappedUser = wrapUserRequest(content, false);

    // Filter and wrap attachments as untrusted content
    let finalContent = wrappedUser;
    if (attachmentsInner && attachmentsInner.length > 0) {
      const wrappedFiles = wrapAttachments(attachmentsInner);
      finalContent = `${wrappedUser}\n\n${wrappedFiles}`;
    }

    const msg = new HumanMessage({ content: finalContent });
    this.addMessageWithTokens(msg);
  }

  /**
   * Adds a plan message to the history
   * @param plan - The raw description of the plan
   * @param position - The position to add the plan
   */
  public addPlan(plan?: string, position?: number): void {
    if (plan) {
      const cleanedPlan = filterExternalContent(plan, false);
      const msg = new AIMessage({ content: `<plan>${cleanedPlan}</plan>` });
      this.addMessageWithTokens(msg, null, position);
    }
  }

  /**
   * Adds a state message to the history
   *
   * A new state message marks the start of a new navigator turn: this closes out the
   * previous turn's length in the rolling window and, if that leaves us over
   * maxHistoryTurns, drops the oldest turn(s) before the new state message is added.
   * @param stateMessage - The HumanMessage object containing the state
   */
  public addStateMessage(stateMessage: HumanMessage): void {
    this._closeTurnAndEnforceWindow();
    this.addMessageWithTokens(stateMessage);
  }

  /**
   * Closes the currently-accumulating turn (if any messages were added to it) and, while
   * there are more completed turns than maxHistoryTurns allows, drops the oldest ones -
   * removing every message they contain (never just part of one, so an AIMessage tool
   * call and its ToolMessage response are always dropped together) - and keeps a single
   * placeholder message up to date with how many turns have been elided so far.
   */
  private _closeTurnAndEnforceWindow(): void {
    if (this.currentTurnLength > 0) {
      this.turnLengths.push(this.currentTurnLength);
      this.currentTurnLength = 0;
    }

    while (this.turnLengths.length > this.settings.maxHistoryTurns) {
      const oldestTurnLength = this.turnLengths.shift();
      if (oldestTurnLength === undefined) break;
      for (let i = 0; i < oldestTurnLength; i++) {
        this.history.removeOldestMessage();
      }
      this.elidedTurns += 1;
    }

    if (this.elidedTurns > 0) {
      this._updateTruncationPlaceholder();
    }
  }

  /**
   * Creates (once) or updates the single placeholder message that tells the model history
   * was truncated, instead of leaving it to silently see a gap. Updating in place - rather
   * than removing and re-inserting - keeps its position (and this.truncationPlaceholder's
   * validity) stable across repeated truncations.
   */
  private _updateTruncationPlaceholder(): void {
    const content = `[... ${this.elidedTurns} earlier step${this.elidedTurns === 1 ? '' : 's'} omitted from history to stay within the context budget ...]`;

    if (this.truncationPlaceholder) {
      const oldTokens = this.truncationPlaceholder.metadata.tokens;
      this.truncationPlaceholder.message.content = content;
      const newTokens = this._countTokens(this.truncationPlaceholder.message);
      this.truncationPlaceholder.metadata.tokens = newTokens;
      this.history.totalTokens += newTokens - oldTokens;
      return;
    }

    const insertAt = this.history.seedCount;
    const msg = new HumanMessage({ content });
    this.addMessageWithTokens(msg, 'history_truncated', insertAt);
    this.truncationPlaceholder = this.history.messages[insertAt];
    // The placeholder itself must never be dropped by a later round of trimming.
    this.history.seedCount += 1;
  }

  /**
   * Adds a model output message to the history
   * @param modelOutput - The model output
   */
  public addModelOutput(modelOutput: Record<string, unknown>): void {
    const toolCallId = this.nextToolId();
    const toolCalls = [
      {
        name: 'AgentOutput',
        args: modelOutput,
        id: String(toolCallId),
        type: 'tool_call' as const,
      },
    ];

    const msg = new AIMessage({
      content: 'tool call',
      tool_calls: toolCalls,
    });
    this.addMessageWithTokens(msg);

    // Need a placeholder for the tool response here to avoid errors sometimes
    // NOTE: in browser-use, it uses an empty string
    this.addToolMessage('tool call response', toolCallId);
  }

  /**
   * Removes the last state message from the history (used when a step is retried or
   * cancelled after the state message was already added, before any model output followed
   * it). Keeps the rolling-window turn-length counter in sync with what's actually still
   * in history: if nothing was removed, the count is left untouched.
   */
  public removeLastStateMessage(): void {
    this._popLastStateMessage();
  }

  /**
   * @returns true if a message was actually popped
   */
  private _popLastStateMessage(): boolean {
    const removed = this.history.removeLastStateMessage();
    if (removed) {
      this.currentTurnLength = Math.max(0, this.currentTurnLength - 1);
    }
    return removed;
  }

  public getMessages(): BaseMessage[] {
    const messages = this.history.messages
      .filter(m => {
        if (!m.message) {
          console.error(`[MessageManager] Filtering out message with undefined message property:`, m);
          return false;
        }
        return true;
      })
      .map(m => m.message);

    let totalInputTokens = 0;
    logger.debug(`Messages in history: ${this.history.messages.length}:`);

    for (const m of this.history.messages) {
      totalInputTokens += m.metadata.tokens;
      if (m.message) {
        logger.debug(`${m.message.constructor.name} - Token count: ${m.metadata.tokens}`);
      } else {
        console.error(`[MessageManager] Found message with undefined message property:`, m);
        logger.debug(`Message with undefined message property - Token count: ${m.metadata.tokens}`);
      }
    }

    logger.debug(`Total input tokens: ${totalInputTokens}`);
    return messages;
  }

  /**
   * Adds a message to the history with the token count metadata
   * @param message - The BaseMessage object to add
   * @param messageType - The type of the message (optional)
   * @param position - The optional position to add the message, if not provided, the message will be added to the end of the history
   */
  public addMessageWithTokens(message: BaseMessage, messageType?: string | null, position?: number): void {
    let filteredMessage = message;
    // filter out sensitive data if provided
    if (this.settings.sensitiveData) {
      filteredMessage = this._filterSensitiveData(message);
    }

    const tokenCount = this._countTokens(filteredMessage);
    const metadata: MessageMetadata = new MessageMetadata(tokenCount, messageType);
    this.history.addMessage(filteredMessage, metadata, position);

    // The truncation placeholder isn't part of any turn - don't let it count toward one.
    if (messageType !== 'history_truncated') {
      this.currentTurnLength += 1;
    }

    // Enforce the (estimated) token budget: cutMessages() was previously fully implemented
    // but never called, so history grew unbounded until the LLM provider itself rejected
    // an oversized request. This is a secondary, tighter-in-the-worst-case safety net on
    // top of the turn-based rolling window above - it can still fire between turns if a
    // single message (e.g. a large page-state dump) is unusually large.
    if (this.history.totalTokens > this.settings.maxInputTokens) {
      this.cutMessages();
    }
  }

  /**
   * Filters out sensitive data from the message
   * @param message - The BaseMessage object to filter
   * @returns The filtered BaseMessage object
   */
  private _filterSensitiveData(message: BaseMessage): BaseMessage {
    const replaceSensitive = (value: string): string => {
      let filteredValue = value;
      if (!this.settings.sensitiveData) return filteredValue;

      for (const [key, val] of Object.entries(this.settings.sensitiveData)) {
        // Skip empty values to match Python behavior
        if (!val) continue;
        filteredValue = filteredValue.replace(val, `<secret>${key}</secret>`);
      }
      return filteredValue;
    };

    if (typeof message.content === 'string') {
      message.content = replaceSensitive(message.content);
    } else if (Array.isArray(message.content)) {
      message.content = message.content.map(item => {
        // Add null check to match Python's isinstance() behavior
        if (typeof item === 'object' && item !== null && 'text' in item) {
          return { ...item, text: replaceSensitive(item.text) };
        }
        return item;
      });
    }

    return message;
  }

  /**
   * Counts the tokens in the message
   * @param message - The BaseMessage object to count the tokens
   * @returns The number of tokens in the message
   */
  private _countTokens(message: BaseMessage): number {
    let tokens = 0;

    if (Array.isArray(message.content)) {
      for (const item of message.content) {
        if ('image_url' in item) {
          tokens += this.settings.imageTokens;
        } else if (typeof item === 'object' && 'text' in item) {
          tokens += this._countTextTokens(item.text);
        }
      }
    } else {
      let msg = message.content;
      // Check if it's an AIMessage with tool_calls
      if ('tool_calls' in message) {
        msg += JSON.stringify(message.tool_calls);
      }
      tokens += this._countTextTokens(msg);
    }

    return tokens;
  }

  /**
   * Counts the tokens in the text
   * Rough estimate, no tokenizer provided for now
   * @param text - The text to count the tokens
   * @returns The number of tokens in the text
   */
  private _countTextTokens(text: string): number {
    return Math.floor(text.length / this.settings.estimatedCharactersPerToken);
  }

  /**
   * Cuts the last message if the total tokens exceed the max input tokens: first drops any
   * image content from it, then - if that alone isn't enough - proportionally trims its
   * text. Called from addMessageWithTokens() whenever a message pushes history over the
   * (estimated, not exact) token budget; throws if even the last message alone can't be
   * shrunk enough, since at that point no message-level fix remains (shorten the system
   * prompt or task instead).
   */
  public cutMessages(): void {
    let diff = this.history.totalTokens - this.settings.maxInputTokens;
    if (diff <= 0) return;

    const lastMsg = this.history.messages[this.history.messages.length - 1];

    // if list with image remove image
    if (Array.isArray(lastMsg.message.content)) {
      let text = '';
      lastMsg.message.content = lastMsg.message.content.filter(item => {
        if ('image_url' in item) {
          diff -= this.settings.imageTokens;
          lastMsg.metadata.tokens -= this.settings.imageTokens;
          this.history.totalTokens -= this.settings.imageTokens;
          logger.debug(
            `Removed image with ${this.settings.imageTokens} tokens - total tokens now: ${this.history.totalTokens}/${this.settings.maxInputTokens}`,
          );
          return false;
        }
        if ('text' in item) {
          text += item.text;
        }
        return true;
      });
      lastMsg.message.content = text;
      this.history.messages[this.history.messages.length - 1] = lastMsg;
    }

    if (diff <= 0) return;

    // if still over, remove text from state message proportionally to the number of tokens needed with buffer
    // Calculate the proportion of content to remove
    const proportionToRemove = diff / lastMsg.metadata.tokens;
    if (proportionToRemove > 0.99) {
      throw new Error(
        `Max token limit reached - history is too long - reduce the system prompt or task. proportion_to_remove: ${proportionToRemove}`,
      );
    }
    logger.debug(
      `Removing ${(proportionToRemove * 100).toFixed(2)}% of the last message (${(proportionToRemove * lastMsg.metadata.tokens).toFixed(2)} / ${lastMsg.metadata.tokens.toFixed(2)} tokens)`,
    );

    const content = lastMsg.message.content as string;
    const charactersToRemove = Math.floor(content.length * proportionToRemove);
    const newContent = content.slice(0, -charactersToRemove);

    // remove tokens and old long message
    this._popLastStateMessage();

    // new message with updated content
    const msg = new HumanMessage({ content: newContent });
    this.addMessageWithTokens(msg);

    const finalMsg = this.history.messages[this.history.messages.length - 1];
    logger.debug(
      `Added message with ${finalMsg.metadata.tokens} tokens - total tokens now: ${this.history.totalTokens}/${this.settings.maxInputTokens} - total messages: ${this.history.messages.length}`,
    );
  }

  /**
   * Adds a tool message to the history
   * @param content - The content of the tool message
   * @param toolCallId - The tool call id of the tool message, if not provided, a new tool call id will be generated
   * @param messageType - The type of the tool message
   */
  public addToolMessage(content: string, toolCallId?: number, messageType?: string | null): void {
    const id = toolCallId ?? this.nextToolId();
    const msg = new ToolMessage({ content, tool_call_id: String(id) });
    this.addMessageWithTokens(msg, messageType);
  }
}
