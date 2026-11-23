import { useEffect, useRef, useState } from 'react';
import { Bot, Send, ShieldCheck, Sparkles } from 'lucide-react';
import { api, apiGet } from '../api.js';
import { Badge, ErrorBanner, PageHeader, Spinner, useToast } from '../ui.jsx';

export default function Assistant() {
  const toast = useToast();
  const [suggestions, setSuggestions] = useState([]);
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);
  const threadRef = useRef(null);

  useEffect(() => {
    apiGet('/assistant/suggestions')
      .then((data) => {
        setSuggestions(data.suggestions || []);
        setMeta(data);
      })
      .catch(setError);
  }, []);

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const ask = async (text) => {
    const trimmed = text.trim();
    if (trimmed.length < 3) {
      toast.error('Tulis pertanyaan minimal 3 karakter.');
      return;
    }
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setMessages((current) => [...current, { id, question: trimmed, response: null, error: null }]);
    setQuestion('');
    setBusy(true);
    try {
      const response = await api('/assistant/query', { method: 'POST', body: { question: trimmed } });
      setMessages((current) => current.map((item) => (item.id === id ? { ...item, response } : item)));
    } catch (err) {
      setMessages((current) => current.map((item) => (item.id === id ? { ...item, error: err.message } : item)));
    } finally {
      setBusy(false);
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (busy) return;
    ask(question);
  };

  return (
    <>
      <PageHeader
        eyebrow="Asisten armada"
        title="Fleet Assistant"
        subtitle="Tanya kondisi operasional armada. Jawaban dihitung dari data DEMO dengan aturan kata kunci, hanya-baca, dan menyebutkan sumber datanya."
        actions={
          <span className="badge badge-blue">
            <ShieldCheck size={13} /> Read-only
          </span>
        }
      />

      <ErrorBanner error={error} onDismiss={() => setError(null)} />

      <div className="panel intel-notice">
        <Sparkles size={18} />
        <div>
          <b>Rule-based, bukan AI generatif.</b>
          <p>
            Tidak ada panggilan ke layanan AI eksternal, API key, atau model bahasa. Setiap jawaban berasal dari kueri database demo dan aturan
            kata kunci yang dapat diaudit. Asisten tidak dapat mengubah data; aksi tetap dilakukan lewat modul dengan RBAC dan audit log.
          </p>
        </div>
      </div>

      <div className="assistant-layout">
        <section className="panel assistant-suggestions">
          <h3 className="panel-title">Pertanyaan cepat</h3>
          <p className="muted assistant-hint">Pilih topik; pertanyaan dikirim sebagai kueri hanya-baca.</p>
          <div className="assistant-chips">
            {suggestions.map((item) => (
              <button key={item.id} type="button" className="assistant-chip" onClick={() => ask(item.question)} disabled={busy}>
                {item.label}
              </button>
            ))}
          </div>
          {meta?.role && (
            <p className="assistant-scope">
              <ShieldCheck size={14} /> Akses sesuai role: <b>{meta.role}</b>
            </p>
          )}
        </section>

        <section className="panel assistant-thread-panel">
          <div className="assistant-thread" ref={threadRef} aria-live="polite">
            {messages.length === 0 ? (
              <div className="assistant-empty">
                <Bot size={28} />
                <h3>Mulai percakapan</h3>
                <p className="muted">
                  Contoh: “Booking apa yang menunggu persetujuan?”, “Kendaraan mana yang perlu servis?”, atau “Ada defect kritis?”.
                </p>
              </div>
            ) : (
              messages.map((message) => (
                <div className="assistant-turn" key={message.id}>
                  <div className="assistant-msg-user">{message.question}</div>
                  {message.error ? (
                    <div className="assistant-msg-bot">
                      <Badge value="ERROR" tone="red" label="Gagal" />
                      <p>{message.error}</p>
                    </div>
                  ) : message.response ? (
                    <article className="assistant-msg-bot">
                      <div className="assistant-answer-head">
                        <b>{message.response.title}</b>
                        <Badge value={message.response.intent} tone="blue" label={`Aturan: ${message.response.intent}`} />
                      </div>
                      <p>{message.response.answer}</p>
                      {message.response.bullets?.length > 0 && (
                        <ul className="assistant-bullets">
                          {message.response.bullets.map((bullet, index) => (
                            <li key={index}>{bullet}</li>
                          ))}
                        </ul>
                      )}
                      <div className="assistant-sources">
                        <span>Sumber data:</span>
                        {message.response.sources.length ? (
                          message.response.sources.map((source) => (
                            <span className="assistant-source-chip" key={source}>
                              {source}
                            </span>
                          ))
                        ) : (
                          <span className="muted">petunjuk kapabilitas</span>
                        )}
                      </div>
                      <p className="assistant-disclaimer">{message.response.disclaimer}</p>
                    </article>
                  ) : (
                    <div className="assistant-msg-bot assistant-loading">
                      <Spinner size={16} /> Menghitung dari database demo...
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <form className="assistant-form" onSubmit={submit}>
            <label className="sr-only" htmlFor="assistant-question">
              Pertanyaan untuk fleet assistant
            </label>
            <input
              id="assistant-question"
              type="text"
              value={question}
              maxLength={300}
              placeholder="Tulis pertanyaan operasional…"
              onChange={(event) => setQuestion(event.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={busy || question.trim().length < 3}>
              <Send size={15} /> Tanya
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
