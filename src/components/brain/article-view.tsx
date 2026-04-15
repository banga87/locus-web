// Editorial read-view for a brain document. Pure presentational wrapper that
// owns only layout — the page supplies the rendered body (DocumentRenderer)
// and any topbar actions. Server-safe.
//
// Class names are defined in src/app/globals.css under the "=== App shell ==="
// section (.topbar / .crumbs / .article-wrap / .article / .eyebrow / .title /
// .deck / .meta-row) and were added in Task 5.

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { Freshness } from '@/lib/brain/freshness';

export interface ArticleViewProps {
  /** Contextual prefix above the title, e.g. "Product & Service · Core". */
  eyebrow: string;
  title: string;
  /** Summary field; `null` renders no deck. */
  deck: string | null;
  meta: {
    status: string;
    confidence: string;
    /** Pre-formatted relative string, e.g. "13 hours ago". */
    updatedAt: string;
    /** Pre-computed so the page only classifies freshness once. */
    updatedFreshness: Freshness;
    author: string;
    agentReads?: number;
  };
  /** Rendered document body (e.g. <DocumentRenderer />). */
  children: ReactNode;
  breadcrumb: Array<{ label: string; href?: string }>;
  /** Optional topbar actions (edit, theme toggle, etc). */
  actions?: ReactNode;
}

export function ArticleView({
  eyebrow,
  title,
  deck,
  meta,
  children,
  breadcrumb,
  actions,
}: ArticleViewProps) {
  return (
    <>
      <div className="topbar">
        <nav className="crumbs" aria-label="Breadcrumb">
          {breadcrumb.map((c, i) => {
            const isLast = i === breadcrumb.length - 1;
            return (
              <span key={i} className={isLast ? 'cur' : undefined}>
                {c.href && !isLast ? <Link href={c.href}>{c.label}</Link> : c.label}
                {!isLast && <span> / </span>}
              </span>
            );
          })}
        </nav>
        <div className="topbar-spacer" />
        {actions}
      </div>

      <div className="article-wrap">
        <article className="article">
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1 className="title">{title}</h1>
          {deck && <p className="deck">{deck}</p>}

          <div className="meta-row">
            <div className="item">
              <span>Status</span>
              <span className="val">{meta.status}</span>
            </div>
            <div className="item">
              <span>Confidence</span>
              <span className="val">{meta.confidence}</span>
            </div>
            <div className="item" data-freshness={meta.updatedFreshness}>
              <span>Updated</span>
              <span className="val">{meta.updatedAt}</span>
            </div>
            <div className="item">
              <span>Author</span>
              <span className="val">{meta.author}</span>
            </div>
            {typeof meta.agentReads === 'number' && (
              <div className="item">
                <span>Agent reads</span>
                <span className="val">{meta.agentReads}</span>
              </div>
            )}
          </div>

          {children}
        </article>
      </div>
    </>
  );
}
