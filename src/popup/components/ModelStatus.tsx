/**
 * Model Status Component
 *
 * Shows the loading progress of the WebLLM model with phase-specific messages.
 */

import React from 'react';

interface ModelStatusProps {
  progress: number;
  phase?: 'downloading' | 'loading_from_cache' | 'initializing';
  phaseText?: string;
}

export function ModelStatus({ progress, phase, phaseText }: ModelStatusProps): React.ReactElement {
  const percentage = Math.round(progress * 100);

  // Determine the status message based on phase
  let statusMessage = '';
  let statusIcon = '';

  if (percentage >= 100) {
    statusMessage = 'Ready!';
    statusIcon = '✓';
  } else if (phase === 'loading_from_cache') {
    statusMessage = `Loading from cache... ${percentage}%`;
    statusIcon = '✓';
  } else if (phase === 'downloading') {
    statusMessage = `Downloading model... ${percentage}%`;
    statusIcon = '⬇';
  } else if (phase === 'initializing') {
    statusMessage = `Initializing GPU... ${percentage}%`;
    statusIcon = '⚡';
  } else {
    // Fallback for when phase is not detected yet
    statusMessage = `Loading... ${percentage}%`;
    statusIcon = '⚙';
  }

  // Determine the note based on phase and progress
  let note = '';
  if (percentage >= 100) {
    note = 'Model loaded successfully!';
  } else if (phase === 'loading_from_cache') {
    note = 'Loading model from cache - this should be fast!';
  } else if (phase === 'downloading') {
    note = 'First run downloads the model (~1GB). It will be cached for future use.';
  } else if (phase === 'initializing') {
    note = 'Almost there! Loading model into GPU memory...';
  } else if (percentage < 50) {
    note = 'First run may take a while as the model downloads (~1GB). It will be cached for future use.';
  } else {
    note = 'Almost there! Loading model into GPU memory...';
  }

  return (
    <div className="model-status">
      <h2>Loading AI Model</h2>

      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${percentage}%` }}
        />
      </div>

      <div className="progress-text">
        {statusIcon} {statusMessage}
      </div>

      {phaseText && (
        <div className="phase-details" style={{ fontSize: '12px', color: '#888', marginTop: '4px' }}>
          {phaseText}
        </div>
      )}

      <p className="note">
        {note}
      </p>
    </div>
  );
}
