import { useMemo } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import { marked } from "marked";

const files = import.meta.glob("../docs/*.md", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export const DOCS = Object.entries(files)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, body]) => {
    const slug = path.split("/").pop()!.replace(/^\d+-/, "").replace(/\.md$/, "");
    const title = body.match(/^# (.+)$/m)?.[1] ?? slug;
    return { slug, title, body };
  });

export default function Docs() {
  const { slug = "introduction" } = useParams();
  const idx = Math.max(
    0,
    DOCS.findIndex((d) => d.slug === slug),
  );
  const doc = DOCS[idx];
  const html = useMemo(() => marked.parse(doc.body, { async: false }) as string, [doc]);
  return (
    <main className="container docs">
      <aside className="docs-nav">
        <p className="eyebrow">Documentation</p>
        {DOCS.map((d) => (
          <NavLink key={d.slug} to={`/docs/${d.slug}`} className={d.slug === doc.slug ? "active" : ""} end>
            {d.title}
          </NavLink>
        ))}
      </aside>
      <article className="prose">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: Markdown comes from this repository at build time, not from users */}
        <div dangerouslySetInnerHTML={{ __html: html }} />
        <div className="pager">
          {idx > 0 ? <Link to={`/docs/${DOCS[idx - 1].slug}`}>← {DOCS[idx - 1].title}</Link> : <span />}
          {idx < DOCS.length - 1 ? <Link to={`/docs/${DOCS[idx + 1].slug}`}>{DOCS[idx + 1].title} →</Link> : <span />}
        </div>
      </article>
    </main>
  );
}
