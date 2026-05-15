import type { AiEmailTodo, AiEmailTodoStatus } from '../../../types/mailTriage'

const STORE_KEY = 'ai:mail-todos:v1'
const MAX_TODOS = 1000

type TodoStore = Record<string, AiEmailTodo>

function load(): TodoStore {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as TodoStore
  } catch {
    return {}
  }
}

function save(store: TodoStore): void {
  try {
    const entries = Object.entries(store)
    if (entries.length > MAX_TODOS) {
      entries.sort((a, b) => (a[1].updatedAt ?? a[1].createdAt).localeCompare(b[1].updatedAt ?? b[1].createdAt))
      localStorage.setItem(STORE_KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_TODOS))))
      return
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(store))
  } catch { /* local quota must not break mail flow */ }
}

function scopedKey(accountId: string, workspaceId: string, todoId: string): string {
  return `${accountId}:${workspaceId}:${todoId}`
}

export function getMailTodos(accountId: string, workspaceId: string): AiEmailTodo[] {
  const prefix = `${accountId}:${workspaceId}:`
  return Object.entries(load())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, todo]) => todo)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'pending' ? -1 : 1
      return (a.deadline || a.createdAt).localeCompare(b.deadline || b.createdAt)
    })
}

export function getMailTodosForMessage(accountId: string, workspaceId: string, messageId: string): AiEmailTodo[] {
  return getMailTodos(accountId, workspaceId).filter((todo) => todo.sourceEmailId === messageId)
}

export function mergeAnalysisTodos(accountId: string, workspaceId: string, todos: AiEmailTodo[]): AiEmailTodo[] {
  const store = load()
  const merged: AiEmailTodo[] = []

  for (const todo of todos) {
    const key = scopedKey(accountId, workspaceId, todo.id)
    const existing = store[key]
    const next: AiEmailTodo = {
      ...todo,
      accountId,
      workspaceId,
      status: existing?.status ?? todo.status,
      createdAt: existing?.createdAt ?? todo.createdAt,
      updatedAt: new Date().toISOString(),
    }
    store[key] = next
    merged.push(next)
  }

  save(store)
  return merged
}

export function updateMailTodoStatus(
  accountId: string,
  workspaceId: string,
  todoId: string,
  status: AiEmailTodoStatus,
): AiEmailTodo | null {
  const store = load()
  const key = scopedKey(accountId, workspaceId, todoId)
  const existing = store[key]
  if (!existing) return null
  const next = { ...existing, status, updatedAt: new Date().toISOString() }
  store[key] = next
  save(store)
  return next
}

