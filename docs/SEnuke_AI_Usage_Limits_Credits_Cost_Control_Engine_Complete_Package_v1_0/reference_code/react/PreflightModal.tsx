import React from 'react';

export function PreflightModal({ decision, onConfirm, onCancel, onUpgrade }: any) {
  if (!decision) return null;

  return (
    <div className="modal">
      <h2>{decision.decision === 'require_upgrade' ? 'Upgrade Required' : 'Confirm Action'}</h2>
      <p>{decision.message}</p>
      {decision.estimatedCredits > 0 && (
        <p>This action will use <strong>{decision.estimatedCredits}</strong> credits.</p>
      )}
      {decision.remainingCreditsAfterAction !== undefined && (
        <p>Remaining after action: <strong>{decision.remainingCreditsAfterAction}</strong></p>
      )}
      <div className="actions">
        {decision.decision === 'require_upgrade' ? (
          <button onClick={onUpgrade}>Upgrade</button>
        ) : (
          <button onClick={onConfirm}>Run Action</button>
        )}
        <button onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
