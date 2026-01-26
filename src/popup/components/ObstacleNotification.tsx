/**
 * Obstacle Notification Component
 *
 * Displays obstacles that block task execution with clear guidance.
 * Provides instructions for resolving each type of obstacle.
 */

import React from 'react';

export interface ObstacleInfo {
  type: 'LOGIN_REQUIRED' | 'CAPTCHA' | 'OUT_OF_STOCK' | 'PRICE_CHANGED' | 'ERROR';
  message: string;
  timestamp?: number;
}

interface ObstacleNotificationProps {
  obstacle: ObstacleInfo;
  onResume: () => void;
  onCancel: () => void;
}

export function ObstacleNotification({
  obstacle,
  onResume,
  onCancel,
}: ObstacleNotificationProps): React.ReactElement {
  // Get obstacle-specific details
  const getObstacleDetails = () => {
    switch (obstacle.type) {
      case 'LOGIN_REQUIRED':
        return {
          icon: '🔐',
          title: 'Login Required',
          description: 'The website requires you to sign in before continuing.',
          instructions: [
            'Switch to the browser tab',
            'Sign in to your account',
            'Come back here and click "Resume Task"',
          ],
          canResume: true,
          severity: 'warning' as const,
        };

      case 'CAPTCHA':
        return {
          icon: '🤖',
          title: 'CAPTCHA Verification',
          description: 'The website is asking for human verification.',
          instructions: [
            'Switch to the browser tab',
            'Complete the CAPTCHA challenge',
            'Come back here and click "Resume Task"',
          ],
          canResume: true,
          severity: 'warning' as const,
        };

      case 'OUT_OF_STOCK':
        return {
          icon: '📦',
          title: 'Item Out of Stock',
          description: 'The item you requested is currently unavailable.',
          instructions: [
            'The task cannot be completed as requested',
            'You may need to select a different item',
            'Or wait for the item to be restocked',
          ],
          canResume: false,
          severity: 'error' as const,
        };

      case 'PRICE_CHANGED':
        return {
          icon: '💰',
          title: 'Price Changed',
          description: 'The item price has changed since the task started.',
          instructions: [
            'Check the browser tab to verify the new price',
            'Click "Resume Task" to continue if acceptable',
            'Or click "Cancel" to stop the task',
          ],
          canResume: true,
          severity: 'warning' as const,
        };

      case 'ERROR':
      default:
        return {
          icon: '⚠️',
          title: 'Error Encountered',
          description: obstacle.message || 'An unexpected error occurred.',
          instructions: [
            'Check the browser tab for any error messages',
            'Try refreshing the page',
            'Click "Cancel" and restart the task',
          ],
          canResume: false,
          severity: 'error' as const,
        };
    }
  };

  const details = getObstacleDetails();

  return (
    <div className={`obstacle-notification ${details.severity}`}>
      <div className="obstacle-header">
        <div className="obstacle-icon">{details.icon}</div>
        <div className="obstacle-title-section">
          <h2>{details.title}</h2>
          <p className="obstacle-description">{details.description}</p>
        </div>
      </div>

      <div className="obstacle-instructions">
        <h3>What to do:</h3>
        <ol>
          {details.instructions.map((instruction, index) => (
            <li key={index}>{instruction}</li>
          ))}
        </ol>
      </div>

      {obstacle.message && obstacle.type === 'ERROR' && (
        <div className="obstacle-details">
          <strong>Details:</strong>
          <pre>{obstacle.message}</pre>
        </div>
      )}

      <div className="obstacle-actions">
        {details.canResume && (
          <button className="resume-button" onClick={onResume}>
            ✓ Resume Task
          </button>
        )}
        <button className="cancel-button" onClick={onCancel}>
          {details.canResume ? 'Cancel Task' : 'Close'}
        </button>
      </div>

      <div className="obstacle-timestamp">
        {obstacle.timestamp && (
          <span>
            Detected at {new Date(obstacle.timestamp).toLocaleTimeString()}
          </span>
        )}
      </div>
    </div>
  );
}
