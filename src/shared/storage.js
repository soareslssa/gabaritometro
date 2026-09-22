/**
 * Camada única de acesso ao chrome.storage.local.
 * Todas as escritas passam por aqui para manter attempts, days e subjects
 * consistentes entre si (os agregados são mantidos incrementalmente).
 */
(function (root) {
  const RC = (root.RC = root.RC || {});
  const K = RC.KEYS;

  /** Serializa escritas concorrentes — content script e popup podem escrever juntos. */
  let queue = Promise.resolve();
  function serial(fn) {
    const next = queue.then(fn, fn);
    queue = next.catch(() => {});
    return next;
  }

  async function get(keys) {
    return chrome.storage.local.get(keys);
  }

  /**
   * Credita tempo no objeto `time` em memória, sem gravar.
   * Existe separado de `commitTime` para poder ser chamado de dentro de outra
   * operação já serializada — `serial()` dentro de `serial()` travaria a fila.
   */
  function applyTime(time, day, materia, ms, closedBlock) {
    const d = time[day] || (time[day] = { totalMs: 0, blocks: 0, byMateria: {} });
    d.totalMs += ms;
    if (closedBlock) d.blocks += 1;
    const key = materia || '—';
    d.byMateria[key] = (d.byMateria[key] || 0) + ms;
    return d;
  }

  RC.store = {
    async getSettings() {
      const r = await get(K.settings);
      return Object.assign({}, RC.DEFAULT_SETTINGS, r[K.settings] || {});
    },

    async setSettings(patch) {
      return serial(async () => {
        const cur = await RC.store.getSettings();
        const next = Object.assign({}, cur, patch);
        await chrome.storage.local.set({ [K.settings]: next });
        return next;
      });
    },

    async getAll() {
      const r = await get([K.attempts, K.days, K.subjects, K.streak, K.settings, K.version, K.time]);
      return {
        version: r[K.version] || RC.SCHEMA_VERSION,
        attempts: r[K.attempts] || [],
        days: r[K.days] || {},
        subjects: r[K.subjects] || {},
        time: r[K.time] || {},
        streak: r[K.streak] || { current: 0, best: 0, lastDay: null },
        settings: Object.assign({}, RC.DEFAULT_SETTINGS, r[K.settings] || {}),
      };
    },

    /**
     * Registra uma questão respondida.
     * Retorna { saved, reason, day } — saved=false quando é duplicata ignorada.
     */
    async record(rawAttempt) {
      return serial(async () => {
        const settings = await RC.store.getSettings();
        const lr = await get(K.list);
        const list = lr[K.list];
        const activeList = list && !list.finishedAt ? list : null;

        // Há lista aberta: o registro passa a pertencer a ela e herda o que
        // não veio preenchido (o TEC traz seus próprios dados; o PDF, não).
        const raw = activeList
          ? {
              ...rawAttempt,
              listId: rawAttempt.listId || activeList.id,
              materia: rawAttempt.materia || activeList.materia,
              assunto: rawAttempt.assunto || activeList.assunto,
              banca: rawAttempt.banca || activeList.banca,
            }
          : rawAttempt;
        const a = RC.normalize(raw);

        const r = await get([K.attempts, K.days, K.subjects, K.streak]);
        const attempts = r[K.attempts] || [];
        const days = r[K.days] || {};
        const subjects = r[K.subjects] || {};
        const streak = r[K.streak] || { current: 0, best: 0, lastDay: null };

        const key = RC.attemptKey(a);
        const day = RC.dayKey(a.ts);
        const idx = attempts.findIndex((x) => RC.attemptKey(x) === key);

        if (idx !== -1) {
          const prev = attempts[idx];
          // Mesma questão, mesmo dia: 'first' ignora; 'last' sobrescreve o resultado.
          if (settings.countMode === 'first' || prev.correct === a.correct) {
            return { saved: false, reason: 'duplicate', day };
          }
          RC.applyToBucket(days[day] || (days[day] = RC.emptyBucket()), prev, -1);
          const pk = RC.subjectKey(prev);
          if (subjects[pk]) RC.applyToBucket(subjects[pk], prev, -1);
          attempts[idx] = a;
          RC.applyToBucket(days[day], a, 1);
          const sk = RC.subjectKey(a);
          RC.applyToBucket(subjects[sk] || (subjects[sk] = RC.emptyBucket()), a, 1);
          const patch = {
            [K.attempts]: attempts,
            [K.days]: days,
            [K.subjects]: subjects,
          };
          // A lista precisa refletir a troca de resultado, senão o resumo dela
          // passa a discordar do histórico.
          if (activeList && prev.listId === activeList.id) {
            RC.applyToList(activeList, prev, -1);
            RC.applyToList(activeList, a, 1);
            patch[K.list] = activeList;
          }
          await chrome.storage.local.set(patch);
          return { saved: true, reason: 'updated', day, id: a.id, list: patch[K.list] || null };
        }

        attempts.push(a);
        if (attempts.length > RC.MAX_ATTEMPTS) {
          attempts.splice(0, attempts.length - RC.MAX_ATTEMPTS);
        }
        RC.applyToBucket(days[day] || (days[day] = RC.emptyBucket()), a, 1);
        const sk = RC.subjectKey(a);
        RC.applyToBucket(subjects[sk] || (subjects[sk] = RC.emptyBucket()), a, 1);

        const nextStreak = RC.computeStreak(days, streak.best);

        const patch = {
          [K.attempts]: attempts,
          [K.days]: days,
          [K.subjects]: subjects,
          [K.streak]: nextStreak,
          [K.version]: RC.SCHEMA_VERSION,
        };
        if (activeList && a.listId === activeList.id) {
          RC.applyToList(activeList, a, 1);
          patch[K.list] = activeList;
        }
        await chrome.storage.local.set(patch);
        return { saved: true, reason: 'new', day, id: a.id, list: patch[K.list] || null };
      });
    },

    /**
     * Marca/desmarca uma questão já registrada como "chutei".
     * `id` no formato "tec:123"; sem id, age sobre o último registro.
     */
    async setGuess(id, value) {
      return serial(async () => {
        const r = await get([K.attempts, K.days, K.subjects]);
        const attempts = r[K.attempts] || [];
        const days = r[K.days] || {};
        const subjects = r[K.subjects] || {};
        const today = RC.dayKey();

        let idx = -1;
        for (let i = attempts.length - 1; i >= 0; i--) {
          if (RC.dayKey(attempts[i].ts) !== today) break;
          if (!id || attempts[i].id === id) {
            idx = i;
            break;
          }
        }
        if (idx === -1) return { changed: false };

        const a = attempts[idx];
        if (!!a.guessed === !!value) return { changed: false, attempt: a };

        const day = RC.dayKey(a.ts);
        const sk = RC.subjectKey(a);
        if (days[day]) RC.applyToBucket(days[day], a, -1);
        if (subjects[sk]) RC.applyToBucket(subjects[sk], a, -1);
        a.guessed = !!value;
        RC.applyToBucket(days[day] || (days[day] = RC.emptyBucket()), a, 1);
        RC.applyToBucket(subjects[sk] || (subjects[sk] = RC.emptyBucket()), a, 1);

        await chrome.storage.local.set({
          [K.attempts]: attempts,
          [K.days]: days,
          [K.subjects]: subjects,
        });
        return { changed: true, attempt: a };
      });
    },

    /** Remove o último registro do dia (botão Desfazer do painel). */
    async undoLast() {
      return serial(async () => {
        const r = await get([K.attempts, K.days, K.subjects]);
        const attempts = r[K.attempts] || [];
        if (!attempts.length) return { undone: null };
        const a = attempts.pop();
        const days = r[K.days] || {};
        const subjects = r[K.subjects] || {};
        const day = RC.dayKey(a.ts);
        if (days[day]) RC.applyToBucket(days[day], a, -1);
        const sk = RC.subjectKey(a);
        if (subjects[sk]) RC.applyToBucket(subjects[sk], a, -1);
        const patch = {
          [K.attempts]: attempts,
          [K.days]: days,
          [K.subjects]: subjects,
        };
        const lr = await get(K.list);
        const list = lr[K.list];
        if (list && !list.finishedAt && a.listId === list.id) {
          RC.applyToList(list, a, -1);
          patch[K.list] = list;
        }
        await chrome.storage.local.set(patch);
        return { undone: a, list: patch[K.list] || null };
      });
    },

    // ---- lista de questões em curso ---------------------------------------
    async getList() {
      const r = await get(K.list);
      return r[K.list] || null;
    },

    async startList(info) {
      const list = RC.emptyList(info || {}, Date.now());
      await chrome.storage.local.set({ [K.list]: list });
      return list;
    },

    /** Fecha a lista. Não mexe em nenhum total — é só o fim do agrupamento. */
    async finishList() {
      return serial(async () => {
        const r = await get(K.list);
        const list = r[K.list];
        if (!list || list.finishedAt) return list || null;
        list.finishedAt = Date.now();
        await chrome.storage.local.set({ [K.list]: list });
        return list;
      });
    },

    async clearList() {
      await chrome.storage.local.remove(K.list);
    },

    /** Reserva o próximo id da lista, garantindo unicidade mesmo no mesmo ms. */
    async nextListId() {
      return serial(async () => {
        const r = await get(K.list);
        const list = r[K.list];
        if (!list || list.finishedAt) return { id: `pdf:avulsa-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, listId: null };
        list.n = (list.n || 0) + 1;
        await chrome.storage.local.set({ [K.list]: list });
        return { id: `${list.origin}:${list.id}:${list.n}`, listId: list.id };
      });
    },

    // ---- zerar um dia -------------------------------------------------------
    /**
     * Apaga tudo de um dia — questões e horas — preservando os demais dias.
     *
     * Subtrai dos agregados em vez de reconstruir a partir de `attempts`:
     * attempts são podados em MAX_ATTEMPTS, então reconstruir apagaria
     * agregados antigos legítimos de quem já tem histórico longo.
     */
    async resetDay(day) {
      return serial(async () => {
        const r = await get([K.attempts, K.days, K.subjects, K.streak, K.time, K.list]);
        const attempts = r[K.attempts] || [];
        const days = r[K.days] || {};
        const subjects = r[K.subjects] || {};
        const streak = r[K.streak] || { current: 0, best: 0, lastDay: null };
        const time = r[K.time] || {};

        const keep = [];
        let removed = 0;
        for (const a of attempts) {
          if (RC.dayKey(a.ts) !== day) {
            keep.push(a);
            continue;
          }
          removed++;
          const sk = RC.subjectKey(a);
          if (subjects[sk]) RC.applyToBucket(subjects[sk], a, -1);
        }
        for (const [k, b] of Object.entries(subjects)) {
          if (!b.total || b.total <= 0) delete subjects[k];
        }

        const timeMs = (time[day] && time[day].totalMs) || 0;
        delete days[day];
        delete time[day];

        const patch = {
          [K.attempts]: keep,
          [K.days]: days,
          [K.subjects]: subjects,
          [K.time]: time,
          [K.streak]: RC.computeStreak(days, streak.best),
        };
        // Uma lista aberta daquele dia ficaria apontando pra nada.
        const list = r[K.list];
        if (list && RC.dayKey(list.startedAt) === day) patch[K.list] = null;

        await chrome.storage.local.set(patch);
        if (patch[K.list] === null) await chrome.storage.local.remove(K.list);
        return { removed, timeMs };
      });
    },

    // ---- cronômetro / horas líquidas --------------------------------------
    async getTimer() {
      const r = await get(K.timer);
      return r[K.timer] || null;
    },

    async setTimer(state) {
      await chrome.storage.local.set({ [K.timer]: state });
      return state;
    },

    async clearTimer() {
      await chrome.storage.local.remove(K.timer);
    },

    async getTime() {
      const r = await get(K.time);
      return r[K.time] || {};
    },

    /**
     * Credita tempo líquido no dia e na matéria. `blocks` só incrementa quando
     * um bloco é fechado, pra diferenciar "3 blocos" de "3 retomadas".
     */
    async commitTime(day, materia, ms, closedBlock) {
      if (!ms || ms <= 0) return null;
      return serial(async () => {
        const r = await get(K.time);
        const time = r[K.time] || {};
        const d = applyTime(time, day, materia, ms, closedBlock);
        await chrome.storage.local.set({ [K.time]: time });
        return d;
      });
    },

    /**
     * Fecha o trecho em curso, credita o pendente e grava — tudo numa única
     * operação serializada.
     *
     * Precisa ser atômico porque três superfícies (painel do TEC, janela do
     * contador, popup) podem pausar o mesmo bloco. Se duas lessem o estado,
     * calculassem o pendente e gravassem em paralelo, o mesmo tempo seria
     * creditado duas vezes.
     */
    async settleTimer(now, reason, closedBlock) {
      return serial(async () => {
        const r = await get([K.timer, K.time]);
        const s = r[K.timer];
        if (!s) return null;

        const settled = RC.timer.settle(s, now);
        const pending = settled.accumulatedMs - (settled.committedMs || 0);
        const time = r[K.time] || {};
        if (pending > 0) {
          applyTime(time, settled.day, RC.timer.dominantMateria(settled), pending, !!closedBlock);
          settled.committedMs = settled.accumulatedMs;
        } else if (closedBlock && settled.committedMs == null) {
          settled.committedMs = settled.accumulatedMs;
        }

        if (closedBlock) {
          settled.finished = true;
          settled.pausedReason = null;
        } else if (reason) {
          settled.pausedReason = reason;
        }

        await chrome.storage.local.set({ [K.timer]: settled, [K.time]: time });
        return settled;
      });
    },

    // ---- presença das superfícies -------------------------------------------
    async getPresence() {
      const r = await get(K.presence);
      return r[K.presence] || {};
    },

    async touchPresence(token, kind, visible) {
      return serial(async () => {
        const r = await get(K.presence);
        const next = RC.presence.touch(r[K.presence] || {}, token, kind, !!visible, Date.now());
        await chrome.storage.local.set({ [K.presence]: next });
        return next;
      });
    },

    // ---- modo simulado ----------------------------------------------------
    async getSimulado() {
      const r = await get(K.simulado);
      return r[K.simulado] || null;
    },

    async startSimulado(size) {
      const s = { active: true, size, startedAt: Date.now(), ids: [], hits: 0, misses: 0, seconds: 0 };
      await chrome.storage.local.set({ [K.simulado]: s });
      return s;
    },

    /** Soma uma questão ao simulado em curso. Retorna a sessão (active=false ao fechar). */
    async pushSimulado(attemptId, correct, seconds) {
      return serial(async () => {
        const r = await get(K.simulado);
        const s = r[K.simulado];
        if (!s || !s.active || s.ids.includes(attemptId)) return s || null;
        s.ids.push(attemptId);
        if (correct === true) s.hits++;
        else if (correct === false) s.misses++;
        if (Number.isFinite(seconds)) s.seconds += seconds;
        if (s.ids.length >= s.size) {
          s.active = false;
          s.finishedAt = Date.now();
        }
        await chrome.storage.local.set({ [K.simulado]: s });
        return s;
      });
    },

    async stopSimulado() {
      const r = await get(K.simulado);
      const s = r[K.simulado];
      if (!s) return null;
      s.active = false;
      s.finishedAt = Date.now();
      await chrome.storage.local.set({ [K.simulado]: s });
      return s;
    },

    async clearSimulado() {
      await chrome.storage.local.remove(K.simulado);
    },

    async reset() {
      return serial(async () => {
        const settings = await RC.store.getSettings();
        await chrome.storage.local.clear();
        await chrome.storage.local.set({
          [K.settings]: settings,
          [K.version]: RC.SCHEMA_VERSION,
        });
      });
    },

    async exportJSON() {
      const all = await RC.store.getAll();
      return JSON.stringify({ app: 'gabaritometro', exportedAt: Date.now(), ...all }, null, 2);
    },

    /** Importa um export anterior, mesclando por chave de dedupe. */
    async importJSON(text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.attempts)) throw new Error('Arquivo não é um export do Gabaritômetro.');
      return serial(async () => {
        const r = await get([K.attempts]);
        const cur = r[K.attempts] || [];
        const seen = new Set(cur.map(RC.attemptKey));
        const merged = cur.slice();
        let added = 0;
        for (const a of data.attempts) {
          const k = RC.attemptKey(a);
          if (seen.has(k)) continue;
          seen.add(k);
          merged.push(a);
          added++;
        }
        merged.sort((x, y) => x.ts - y.ts);
        const rebuilt = RC.rebuildAggregates(merged);

        // Horas líquidas não são derivadas dos attempts, então precisam de
        // merge próprio. Fica o maior valor por dia: reimportar o mesmo
        // arquivo não pode dobrar o tempo estudado.
        const tr = await get(K.time);
        const time = tr[K.time] || {};
        for (const [day, imported] of Object.entries(data.time || {})) {
          const cur = time[day];
          if (!cur || (imported.totalMs || 0) > (cur.totalMs || 0)) time[day] = imported;
        }

        await chrome.storage.local.set({
          [K.attempts]: merged.slice(-RC.MAX_ATTEMPTS),
          [K.days]: rebuilt.days,
          [K.subjects]: rebuilt.subjects,
          [K.streak]: rebuilt.streak,
          [K.time]: time,
          [K.version]: RC.SCHEMA_VERSION,
        });
        return { added, total: merged.length };
      });
    },
  };

  /** Recalcula days/subjects/streak do zero — usado no import e em recuperação. */
  RC.rebuildAggregates = function (attempts) {
    const days = {};
    const subjects = {};
    for (const a of attempts) {
      const day = RC.dayKey(a.ts);
      RC.applyToBucket(days[day] || (days[day] = RC.emptyBucket()), a, 1);
      const sk = RC.subjectKey(a);
      RC.applyToBucket(subjects[sk] || (subjects[sk] = RC.emptyBucket()), a, 1);
    }
    return { days, subjects, streak: RC.computeStreak(days, 0) };
  };

  /**
   * Ofensiva derivada do conjunto de dias com atividade — e não incremental,
   * porque registros podem chegar fora de ordem (import, correção de dia).
   * A ofensiva atual só vale se o último dia ativo é hoje ou ontem.
   */
  RC.computeStreak = function (days, knownBest) {
    const active = Object.keys(days)
      .filter((d) => days[d] && days[d].total > 0)
      .sort();
    if (!active.length) return { current: 0, best: knownBest || 0, lastDay: null };

    let best = knownBest || 0;
    let run = 0;
    for (let i = 0; i < active.length; i++) {
      run = i > 0 && RC.dayKeyOffset(active[i - 1], 1) === active[i] ? run + 1 : 1;
      if (run > best) best = run;
    }

    const today = RC.dayKey();
    const lastDay = active[active.length - 1];
    const live = lastDay === today || lastDay === RC.dayKeyOffset(today, -1);
    return { current: live ? run : 0, best, lastDay };
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
