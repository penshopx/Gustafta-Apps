import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { SharedHeader } from "@/components/shared-header";
import { Input } from "@/components/ui/input";
import { ArrowUpRight, BookOpen, Check, ChevronRight, FileText, Search, ShieldCheck, Users, X } from "lucide-react";
import guideMarkdown from "../../../docs/panduan-operasional-gustafta.md?raw";
import "./panduan-operasional.css";

type GuideSection = {
  id: string;
  title: string;
  markdown: string;
  searchable: string;
};

const slugify = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function splitGuide(source: string) {
  const lines = source.split(/\r?\n/);
  const intro: string[] = [];
  const sections: GuideSection[] = [];
  let current: GuideSection | null = null;

  for (const line of lines) {
    const sectionHeading = line.match(/^##\s+(.+)$/);
    if (sectionHeading) {
      if (current) sections.push(current);
      current = {
        id: slugify(sectionHeading[1].replace(/\s+#+\s*$/, "")),
        title: sectionHeading[1].replace(/\s+#+\s*$/, ""),
        markdown: `${line}\n`,
        searchable: `${sectionHeading[1]} `,
      };
      continue;
    }
    if (current) {
      current.markdown += `${line}\n`;
      current.searchable += `${line} `;
    } else {
      intro.push(line);
    }
  }
  if (current) sections.push(current);

  return {
    intro: intro.join("\n").trim(),
    sections,
  };
}

const guide = splitGuide(guideMarkdown);

export default function PanduanOperasional() {
  const [query, setQuery] = useState("");
  const searchElement = useRef<HTMLInputElement>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase("id");
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchElement.current?.focus();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);
  const visibleSections = useMemo(
    () =>
      normalizedQuery
        ? guide.sections.filter((section) =>
            section.searchable.toLocaleLowerCase("id").includes(normalizedQuery),
          )
        : guide.sections,
    [normalizedQuery],
  );
  const safeIntro = useMemo(
    () => DOMPurify.sanitize(marked.parse(guide.intro) as string),
    [],
  );

  return (
    <div id="top" className="min-h-[100dvh] bg-background text-foreground">
      <SharedHeader />
      <main className="operational-guide">
        <div className="guide-shell">
          <header className="guide-hero">
            <div className="guide-hero-grid" aria-hidden="true" />
            <div className="guide-hero-content">
              <div className="guide-eyebrow">
                <span className="guide-eyebrow-mark"><BookOpen size={14} /></span>
                PUSAT BANTUAN GUSTAFTA
              </div>
              <div className="guide-hero-title-row">
                <div>
                  <p className="guide-kicker">OPERASIONAL · VERSI 1.0</p>
                  <h1>Panduan <span>operasional</span></h1>
                </div>
                <div className="guide-edition" aria-label="Cakupan panduan">
                  <span>RUJUKAN UNTUK</span>
                  <strong>Semua peran</strong>
                  <small>Pengguna · Admin · Superadmin</small>
                </div>
              </div>
              <p className="guide-deck">
                Cara menggunakan fitur, menjalankan alur kerja, memahami batas akses, dan menangani kendala—dalam satu rujukan.
              </p>
              <div className="guide-hero-meta">
                <span><Users size={15} /> Pengguna, admin, dan superadmin</span>
                <span><ShieldCheck size={15} /> Panduan akses dan praktik aman</span>
              </div>
            </div>
            <div className="guide-hero-index" aria-hidden="true">G / 01</div>
          </header>

          <div className="guide-toolbar">
            <div className="guide-breadcrumb" aria-label="Breadcrumb">
              <Link href="/documentation" className="guide-breadcrumb-link">Dokumentasi</Link>
              <ChevronRight size={14} />
              <span aria-current="page">Panduan operasional</span>
            </div>
            <label className="guide-search">
              <Search size={17} aria-hidden="true" />
              <Input
                type="search"
                value={query}
                ref={searchElement}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Cari topik dalam panduan"
                aria-label="Cari topik dalam panduan operasional"
                className="guide-search-input"
              />
              {query ? (
                <button type="button" className="guide-clear-search" onClick={() => setQuery("")} aria-label="Hapus pencarian">
                  <X size={15} />
                </button>
              ) : (
                <kbd className="guide-search-hint">Ctrl K</kbd>
              )}
            </label>
          </div>

          <div className="guide-layout">
            <aside className="guide-aside" aria-label="Navigasi panduan">
              <div className="guide-aside-heading">
                <span>ISI PANDUAN</span>
                <span className="guide-count">{visibleSections.length.toString().padStart(2, "0")}</span>
              </div>
              <nav className="guide-toc">
                {visibleSections.map((section, index) => (
                  <a key={section.id} href={`#${section.id}`} className="guide-toc-link">
                    <span className="guide-toc-number">{String(index + 1).padStart(2, "0")}</span>
                    <span>{section.title.replace(/^\d+\.\s*/, "")}</span>
                    <ChevronRight size={13} className="guide-toc-arrow" />
                  </a>
                ))}
                {visibleSections.length === 0 && <p className="guide-toc-empty">Tidak ada bagian yang cocok.</p>}
              </nav>
              <div className="guide-aside-note">
                <span className="guide-note-icon"><FileText size={16} /></span>
                <p>Konten mengikuti dokumen operasional resmi Gustafta.</p>
                <span className="guide-note-date">21 NOVEMBER 2026</span>
              </div>
            </aside>

            <article className="guide-article" aria-label="Isi panduan operasional">
              {safeIntro && (
                <section className="guide-intro">
                  <div className="guide-intro-label"><span /> CATATAN PENTING</div>
                  <div className="guide-markdown guide-intro-copy" dangerouslySetInnerHTML={{ __html: safeIntro }} />
                  <div className="guide-principle">
                    <span className="guide-principle-line" />
                    <p>AI membantu menyusun dan menganalisis. Keputusan penting tetap memerlukan tinjauan manusia dan sumber yang berwenang.</p>
                  </div>
                </section>
              )}
              {visibleSections.length ? visibleSections.map((section) => {
                const safeHtml = DOMPurify.sanitize(marked.parse(section.markdown) as string);
                return (
                  <section className="guide-section" id={section.id} key={section.id}>
                    <div className="guide-section-rail" aria-hidden="true" />
                    <div className="guide-markdown" dangerouslySetInnerHTML={{ __html: safeHtml }} />
                  </section>
                );
              }) : (
                <div className="guide-no-results" role="status">
                  <div className="guide-no-results-icon"><Search size={20} /></div>
                  <h2>Topik tidak ditemukan</h2>
                  <p>Coba kata kunci lain seperti “akses”, “langganan”, “Workroom”, atau “admin”.</p>
                  <button type="button" onClick={() => setQuery("")}>Tampilkan semua bagian <ArrowUpRight size={15} /></button>
                </div>
              )}
              <footer className="guide-footer">
                <div className="guide-footer-mark"><Check size={14} /></div>
                <p><strong>Itu seluruh panduannya.</strong><br />Gunakan rujukan ini bersama kebijakan dan instruksi yang berlaku di akun Anda.</p>
                <a href="#top" onClick={(event) => { event.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  Kembali ke atas <ArrowUpRight size={14} />
                </a>
              </footer>
            </article>
          </div>
        </div>
      </main>
    </div>
  );
}
