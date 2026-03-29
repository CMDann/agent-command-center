import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockDispatch = vi.fn();
const mockOnTaskComplete = vi.fn();

vi.mock('../../utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock('../../agents/AgentManager.js', () => ({
  agentManager: {
    dispatch: mockDispatch,
    onTaskComplete: mockOnTaskComplete,
  },
}));

const { useTaskStore } = await import('./useTaskStore.js');

function makeTask(): {
  id: string;
  issueNumber: number;
  title: string;
  body: string;
  labels: string[];
  status: 'backlog';
  repoPath: string;
  createdAt: Date;
  updatedAt: Date;
} {
  return {
    id: 'issue-21',
    issueNumber: 21,
    title: 'Dispatch selected task',
    body: 'Do the thing',
    labels: [],
    status: 'backlog' as const,
    repoPath: '/workspace',
    createdAt: new Date('2026-03-28T00:00:00Z'),
    updatedAt: new Date('2026-03-28T00:00:00Z'),
  };
}

describe('useTaskStore dispatch flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.setState({ tasks: [], selectedTaskId: null });
  });

  it('marks the task in_progress before dispatch and leaves it in_progress on success', async () => {
    mockDispatch.mockResolvedValueOnce(undefined);

    const store = useTaskStore.getState();
    store.enqueue(makeTask());
    store.assign('issue-21', 'claude-1', 'agent');

    await useTaskStore.getState().dispatchToAgent('issue-21');

    const task = useTaskStore.getState().tasks.find((t) => t.id === 'issue-21');
    expect(mockDispatch).toHaveBeenCalledWith('claude-1', expect.objectContaining({ id: 'issue-21' }));
    expect(task?.status).toBe('in_progress');
  });

  it('marks the task error when dispatch fails', async () => {
    mockDispatch.mockRejectedValueOnce(new Error('boom'));

    const store = useTaskStore.getState();
    store.enqueue(makeTask());
    store.assign('issue-21', 'claude-1', 'agent');

    await useTaskStore.getState().dispatchToAgent('issue-21');

    const task = useTaskStore.getState().tasks.find((t) => t.id === 'issue-21');
    expect(task?.status).toBe('error');
  });
});
