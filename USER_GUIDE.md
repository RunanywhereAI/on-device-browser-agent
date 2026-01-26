# User Guide: New Features

## 🎉 What's New

You now have **settings persistence**, **task history**, and a **sidebar interface**!

## 🚀 Getting Started

### First-Time Setup

1. **Rebuild the Extension**:
   ```bash
   npm run build
   ```

2. **Reload in Chrome**:
   - Go to `chrome://extensions`
   - Find "Local Browser - AI Web Agent"
   - Click the reload icon 🔄

3. **Open the Sidebar**:
   - Click the extension icon in your Chrome toolbar
   - The sidebar will open on the right side of your browser

## 📖 Using the Sidebar

### Opening the Sidebar
- Click the extension icon in the toolbar
- Sidebar opens on the right side
- Full-height view for better visibility

### New Task Tab
This is where you create and run tasks:

1. **Select Your Model** (choice is now saved!):
   - Choose from available LLM models
   - Your selection persists across sessions
   - No need to reselect next time

2. **Enter a Task**:
   - Type your natural language task
   - Examples:
     - "Search for 'WebGPU' on Wikipedia"
     - "Go to YouTube and play 'AI tutorials'"
     - "Add 'mechanical keyboard' to Amazon cart"

3. **Run Task**:
   - Click "Run Task"
   - Watch progress in real-time
   - See each step as it executes

### History Tab
View all your past tasks and analytics:

1. **Statistics Dashboard**:
   - **Total Tasks**: All tasks you've run
   - **Successful**: Tasks that completed successfully
   - **Failed**: Tasks that failed
   - **Avg Steps**: Average actions per task
   - **Avg Time**: Average task duration
   - **Total LLM Calls**: How often LLM was used

2. **Task List**:
   - Shows recent tasks (last 50)
   - ✓ Green for success, ✗ Red for failure
   - Click any task to expand details

3. **Task Details**:
   - Model used
   - Result or error message
   - Performance metrics
   - LLM usage percentage

4. **Actions**:
   - **Export JSON**: Download all history as JSON file
   - **Clear History**: Delete all history (with confirmation)

## 💡 Tips & Tricks

### Settings Persistence
Your preferences are automatically saved:
- ✅ Model selection remembered
- ✅ Settings persist across browser restarts
- ✅ No manual save needed

### Understanding Metrics

**LLM Usage %**: Shows how often the LLM was needed
- **Low % (< 10%)**: Good! State machines handled most actions
- **High % (> 50%)**: Task required more LLM help
- **Goal**: Lower is better (faster execution)

**Average Steps**: Number of browser actions
- **Low (< 5)**: Simple tasks
- **Medium (5-15)**: Standard tasks
- **High (> 15)**: Complex workflows

### Best Practices

1. **Check History Tab Regularly**:
   - Identify patterns in failed tasks
   - See which tasks work best
   - Track your success rate

2. **Use Descriptive Tasks**:
   - Good: "Search for 'best laptops 2024' on Amazon"
   - Avoid: "Find stuff"

3. **Monitor Performance**:
   - Low LLM usage = faster execution
   - Check stats to validate optimization

4. **Export Important History**:
   - Before clearing history
   - For sharing bug reports
   - For performance analysis

## 🔍 Troubleshooting

### Sidebar Won't Open
- Make sure extension is reloaded
- Check Chrome version (requires 124+)
- Try clicking icon again

### Settings Not Saving
- Check browser console for errors
- Verify chrome.storage permission
- Try reloading extension

### History Not Showing
- Run at least one task first
- Check History tab is selected
- Look for "Loading..." or "No tasks" message

### Missing Tasks in History
- Only last 50 tasks are kept
- Export before clearing if needed
- Older tasks automatically removed

## 📊 Sample Workflow

1. **First Use**:
   - Open sidebar
   - Select preferred model (e.g., Qwen 2.5 3B)
   - Run a test task
   - Model selection is now saved!

2. **Daily Use**:
   - Click extension icon (sidebar opens)
   - Enter task
   - Click "Run Task"
   - Watch execution
   - Check History tab for results

3. **Weekly Review**:
   - Go to History tab
   - Review statistics
   - Export history for records
   - Clear old tasks if needed

## 🎯 Example Tasks

### Wikipedia Search
```
Search for "Machine Learning" on Wikipedia and extract the first paragraph
```

### YouTube Video
```
Go to YouTube and search for "React tutorials"
```

### Amazon Shopping
```
Go to Amazon and add "USB-C cable" to cart
```

### Web Research
```
Go to Google and search for "best programming languages 2024"
```

## 📈 Understanding Your Stats

### Success Rate
- Total Successful / Total Tasks × 100%
- Goal: > 80% success rate

### Performance
- **Avg Duration**: How long tasks take
- **Avg Steps**: How complex tasks are
- **LLM Calls**: How often AI is needed

### Optimization
- Lower LLM usage = better performance
- Fewer steps = more efficient
- Higher success rate = more reliable

## 🆘 Getting Help

### Check the Console
1. Right-click sidebar
2. Select "Inspect"
3. Go to Console tab
4. Look for error messages

### Export History for Bug Reports
1. Go to History tab
2. Click "Export JSON"
3. Attach to bug report

### Common Issues

**"No active tab found"**:
- Make sure you're on a regular webpage
- Can't run on chrome:// pages

**"Content script not available"**:
- Page may still be loading
- Try refreshing the page

**"Task cancelled by user"**:
- You clicked "Stop Task"
- Start a new task to continue

## 🔐 Privacy

All data is stored locally:
- Settings in chrome.storage.local
- History in chrome.storage.local
- No cloud uploads
- No external servers
- Fully private

## 🎨 Customization

Currently, the interface is fixed, but future updates may include:
- Theme selection
- Custom task templates
- Configurable history limit
- Custom metrics tracking

## 📞 Support

For issues or questions:
- Check console logs
- Export history for debugging
- Report issues with detailed steps to reproduce

---

**Enjoy your new sidebar and task history features!** 🚀
