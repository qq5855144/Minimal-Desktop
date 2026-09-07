import { afterEach, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import BookmarksView from './BookmarksView';
vi.mock('react-dom', () => ({ createPortal: (content: unknown) => content }));
vi.mock('@/contexts/DesktopContext', () => ({ useDesktop: () => ({ data: { bookmarks: {
  groups: [{ id: 'a', name: '学习' }, { id: 'b', name: '工作' }],
  items: [{ id: '1', name: '学习书签', url: 'https://example.com/a', groupId: 'a' }, { id: '2', name: '工作书签', url: 'https://example.com/b', groupId: 'b' }],
} }, updateBookmarks: vi.fn() }) }));
afterEach(() => vi.unstubAllGlobals());
it('initially renders bookmarks from every group with the normal toolbar', () => {
  vi.stubGlobal('document', { body: {} });
  const html = renderToStaticMarkup(<BookmarksView onClose={() => {}} />);
  expect(html).toContain('学习书签'); expect(html).toContain('工作书签');
  expect(html).toContain('>更多</button>'); expect(html).toContain('>编辑</button>');
  expect(html).not.toContain('>移动</button>'); expect(html).toContain('搜索书签');
});
