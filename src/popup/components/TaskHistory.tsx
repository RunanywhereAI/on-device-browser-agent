/**
 * Task History Component
 *
 * Displays historical task executions with statistics and details.
 */

import React, { useState, useEffect } from 'react';
import {
  loadTaskHistory,
  clearTaskHistory,
  getTaskHistoryStats,
  exportTaskHistory,
  formatDuration,
  type TaskHistoryEntry,
} from '../../shared/storage';

export function TaskHistory(): React.ReactElement {
  const [history, setHistory] = useState<TaskHistoryEntry[]>([]);
  const [stats, setStats] = useState<{
    total: number;
    successful: number;
    failed: number;
    averageDuration: number;
    averageSteps: number;
    totalLLMCalls: number;
  } | null>(null);
  const [selectedTask, setSelectedTask] = useState<TaskHistoryEntry | null>(null);
  const [loading, setLoading] = useState(true);

  // Load history on mount
  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const [historyData, statsData] = await Promise.all([
        loadTaskHistory(),
        getTaskHistoryStats(),
      ]);
      setHistory(historyData);
      setStats(statsData);
    } catch (error) {
      console.error('[TaskHistory] Failed to load history:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClearHistory = async () => {
    if (window.confirm('Are you sure you want to clear all task history?')) {
      try {
        await clearTaskHistory();
        await loadHistory();
      } catch (error) {
        console.error('[TaskHistory] Failed to clear history:', error);
      }
    }
  };

  const handleExportHistory = async () => {
    try {
      const json = await exportTaskHistory();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `task-history-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[TaskHistory] Failed to export history:', error);
    }
  };

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();

    if (isToday) {
      return date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
    }

    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className="task-history">
        <div className="loading">Loading history...</div>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="task-history">
        <div className="empty-state">
          <p>No tasks executed yet.</p>
          <p>Your task history will appear here after running tasks.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="task-history">
      {/* Statistics */}
      {stats && (
        <div className="history-stats">
          <div className="stat">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Tasks</div>
          </div>
          <div className="stat">
            <div className="stat-value success">{stats.successful}</div>
            <div className="stat-label">Successful</div>
          </div>
          <div className="stat">
            <div className="stat-value failed">{stats.failed}</div>
            <div className="stat-label">Failed</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.averageSteps}</div>
            <div className="stat-label">Avg Steps</div>
          </div>
          <div className="stat">
            <div className="stat-value">{formatDuration(stats.averageDuration)}</div>
            <div className="stat-label">Avg Time</div>
          </div>
          <div className="stat">
            <div className="stat-value">{stats.totalLLMCalls}</div>
            <div className="stat-label">Total LLM Calls</div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="history-actions">
        <button onClick={handleExportHistory} className="action-button">
          Export JSON
        </button>
        <button onClick={handleClearHistory} className="action-button danger">
          Clear History
        </button>
      </div>

      {/* Task List */}
      <div className="history-list">
        {history.map((task) => (
          <div
            key={task.id}
            className={`history-item ${selectedTask?.id === task.id ? 'selected' : ''}`}
            onClick={() => setSelectedTask(selectedTask?.id === task.id ? null : task)}
          >
            <div className="history-item-header">
              <div className={`history-status ${task.success ? 'success' : 'failed'}`}>
                {task.success ? '✓' : '✗'}
              </div>
              <div className="history-item-title">{task.description}</div>
              <div className="history-item-time">{formatDate(task.timestamp)}</div>
            </div>

            <div className="history-item-meta">
              <span>{task.steps} steps</span>
              <span>•</span>
              <span>{formatDuration(task.duration)}</span>
              <span>•</span>
              <span>{task.llmCalls} LLM calls</span>
              {task.visionMode && (
                <>
                  <span>•</span>
                  <span>👁️ Vision</span>
                </>
              )}
            </div>

            {/* Expanded Details */}
            {selectedTask?.id === task.id && (
              <div className="history-item-details">
                <div className="detail-row">
                  <span className="detail-label">Model:</span>
                  <span className="detail-value">{task.modelId}</span>
                </div>

                {task.success && task.result && (
                  <div className="detail-row">
                    <span className="detail-label">Result:</span>
                    <span className="detail-value result">{task.result}</span>
                  </div>
                )}

                {!task.success && task.error && (
                  <div className="detail-row">
                    <span className="detail-label">Error:</span>
                    <span className="detail-value error">{task.error}</span>
                  </div>
                )}

                <div className="detail-row">
                  <span className="detail-label">Performance:</span>
                  <span className="detail-value">
                    {task.llmCalls} LLM / {task.steps} total steps
                    ({task.steps > 0 ? Math.round((task.llmCalls / task.steps) * 100) : 0}% LLM usage)
                  </span>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
