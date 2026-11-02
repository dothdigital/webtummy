import React from 'react';

export interface ExecutionTask {
  id: string;
  module_name: string;
  task_title: string;
  task_description?: string;
  status: string;
  automation_level: string;
  action_button_label?: string;
}

/**
 * Reference dashboard component.
 * Main UX principle: always show the next executable action, not a disconnected list of tools.
 */
export function ProjectDashboard({ project, tasks, onRunTask }: { project: any; tasks: ExecutionTask[]; onRunTask: (task: ExecutionTask) => void }) {
  const nextTask = tasks.find(t => ['ready', 'needs_review', 'manual_action_required'].includes(t.status));

  return (
    <div className="dashboard">
      <header>
        <h1>{project.project_name}</h1>
        <p>Current step: {project.current_step}</p>
      </header>

      {nextTask && (
        <section className="next-action-card">
          <h2>Next recommended action</h2>
          <h3>{nextTask.task_title}</h3>
          <p>{nextTask.task_description}</p>
          <button onClick={() => onRunTask(nextTask)}>{nextTask.action_button_label ?? 'Continue'}</button>
        </section>
      )}

      <section>
        <h2>Execution Plan</h2>
        <ul>
          {tasks.map(task => (
            <li key={task.id}>
              <strong>{task.task_title}</strong><br />
              <small>{task.module_name} - {task.status} - {task.automation_level}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
