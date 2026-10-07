// Tour `task-reminders` (wave 14, W14-B1). Data only: see ./index.js for the contract.
// Screen: the Tasks view (`start`: /journal/notebook?view=tasks). `tasks-group` is a
// group heading, rendered only once the member has an open task; with none, the tour
// shows the other two steps.
const step = (id, anchor, file) => Object.freeze({ id, anchor, file })
const TASKS = 'components/notebook/NoteTasksView.jsx'

export const STEPS = Object.freeze([
  step('list', 'tasks-list', TASKS),
  step('due', 'tasks-group', TASKS),
  step('remind', 'tasks-tick', TASKS),
])

export const COPY = Object.freeze({
  list: {
    title: 'Every task, one list',
    body: 'Each checklist item in your notes shows up here. Type @today, @tomorrow or a day such as @friday inside an item to give it a due date.',
  },
  due: {
    title: 'Late work comes first',
    body: 'Tasks are grouped Overdue, Today and Upcoming. Select one to open its note at that line.',
  },
  remind: {
    title: 'One reminder a morning',
    body: 'On a day you have open tasks due or overdue, one reminder arrives in your notifications in the morning, Eastern time. Never an email. Tick the task off in its note and it stops counting.',
  },
})
