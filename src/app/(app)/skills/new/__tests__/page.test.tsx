import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import NewSkillPage from '../page';

// Mock next/navigation — the page now also reads `?triggerable=1` via
// useSearchParams(), so the mock has to provide both hooks. The default
// mock returns an empty URLSearchParams, which matches the on-demand
// (non-triggerable) path exercised by the existing tests.
const pushMock = vi.fn();
const searchParamsRef: { current: URLSearchParams } = {
  current: new URLSearchParams(),
};
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => searchParamsRef.current,
}));

// Mock next/link as a passthrough anchor
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('NewSkillPage', () => {
  beforeEach(() => {
    pushMock.mockClear();
    // Reset the mocked search params to the default (no ?triggerable=1) so
    // tests start from the on-demand variant of the form.
    searchParamsRef.current = new URLSearchParams();
    vi.restoreAllMocks();
  });

  it('renders three form fields: name, description, instructions', () => {
    render(<NewSkillPage />);
    expect(screen.getByLabelText(/skill name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/instructions/i)).toBeInTheDocument();
  });

  it('renders a submit button', () => {
    render(<NewSkillPage />);
    expect(screen.getByRole('button', { name: /create skill/i })).toBeInTheDocument();
  });

  it('shows validation error when name is empty', async () => {
    render(<NewSkillPage />);
    fireEvent.click(screen.getByRole('button', { name: /create skill/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/skill name is required/i);
  });

  it('shows validation error when description is empty', async () => {
    render(<NewSkillPage />);
    fireEvent.change(screen.getByLabelText(/skill name/i), { target: { value: 'My Skill' } });
    fireEvent.click(screen.getByRole('button', { name: /create skill/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/description is required/i);
  });

  it('shows validation error when instructions are empty', async () => {
    render(<NewSkillPage />);
    fireEvent.change(screen.getByLabelText(/skill name/i), { target: { value: 'My Skill' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'A description' } });
    fireEvent.click(screen.getByRole('button', { name: /create skill/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/instructions are required/i);
  });

  it('POSTs to /api/skills with the correct body on submit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { skill_id: 'abc-123' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewSkillPage />);
    fireEvent.change(screen.getByLabelText(/skill name/i), { target: { value: 'My Skill' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'A short description' } });
    fireEvent.change(screen.getByLabelText(/instructions/i), { target: { value: '## Do this\n\nAlways be helpful.' } });
    fireEvent.click(screen.getByRole('button', { name: /create skill/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());

    const [url, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/skills');
    expect(opts.method).toBe('POST');
    const body = JSON.parse(opts.body as string);
    expect(body).toEqual({
      name: 'My Skill',
      description: 'A short description',
      instructions: '## Do this\n\nAlways be helpful.',
    });
  });

  it('redirects to /skills/[id] on successful creation', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { skill_id: 'skill-xyz' } }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );

    render(<NewSkillPage />);
    fireEvent.change(screen.getByLabelText(/skill name/i), { target: { value: 'My Skill' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'A short description' } });
    fireEvent.change(screen.getByLabelText(/instructions/i), { target: { value: 'Do helpful things.' } });
    fireEvent.click(screen.getByRole('button', { name: /create skill/i }));

    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/skills/skill-xyz'));
  });

  it('shows slug_taken error message when API returns 409 slug_taken', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { code: 'slug_taken', message: 'Already exists.' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      ),
    );

    render(<NewSkillPage />);
    fireEvent.change(screen.getByLabelText(/skill name/i), { target: { value: 'Duplicate' } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: 'A description' } });
    fireEvent.change(screen.getByLabelText(/instructions/i), { target: { value: 'Instructions here.' } });
    fireEvent.click(screen.getByRole('button', { name: /create skill/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/already exists in this workspace/i);
  });
});
