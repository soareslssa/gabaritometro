/** Agregações de leitura: tudo derivado, nada persistido aqui. */
(function (root) {
  const RC = (root.RC = root.RC || {});

  RC.stats = {
    today(days) {
      return days[RC.dayKey()] || RC.emptyBucket();
    },

    overall(days) {
      const t = RC.emptyBucket();
      for (const d of Object.values(days)) RC.stats.addBucket(t, d);
      return t;
    },

    /** Soma b em t, tolerando buckets gravados antes dos campos de chute. */
    addBucket(t, b) {
      RC.ensureBucket(t);
      t.total += b.total || 0;
      t.hits += b.hits || 0;
      t.misses += b.misses || 0;
      t.voids += b.voids || 0;
      t.seconds += b.seconds || 0;
      t.timed += b.timed || 0;
      t.guesses += b.guesses || 0;
      t.guessHits += b.guessHits || 0;
      return t;
    },

    /** Série dos últimos n dias, do mais antigo ao mais recente (com zeros). */
    series(days, n) {
      const out = [];
      const today = RC.dayKey();
      for (let i = n - 1; i >= 0; i--) {
        const key = RC.dayKeyOffset(today, -i);
        out.push({ day: key, ...(days[key] || RC.emptyBucket()) });
      }
      return out;
    },

    /**
     * Disciplinas ordenadas pela PIOR taxa de acerto — é a lista que diz
     * onde estudar. Filtra amostras pequenas pra não ranquear com 3 questões.
     */
    bySubject(subjects, minSample, groupByMateria) {
      const acc = new Map();
      for (const [key, b] of Object.entries(subjects)) {
        const [materia, assunto] = key.split('||');
        const label = groupByMateria ? materia : `${materia} › ${assunto}`;
        const cur = acc.get(label) || RC.emptyBucket();
        acc.set(label, RC.stats.addBucket(cur, b));
      }
      return [...acc.entries()]
        .map(([label, b]) => ({ label, ...b, rate: RC.hitRate(b), solid: RC.solidRate(b), avg: RC.avgSeconds(b) }))
        .filter((r) => r.hits + r.misses >= (minSample || 1))
        .sort((a, b) => a.rate - b.rate || b.total - a.total);
    },

    /** Compara a soma dos últimos 7 dias com os 7 anteriores. */
    weekDelta(days) {
      const s = RC.stats.series(days, 14);
      const sum = (arr) =>
        arr.reduce((t, d) => ({ hits: t.hits + d.hits, misses: t.misses + d.misses, total: t.total + d.total }), {
          hits: 0,
          misses: 0,
          total: 0,
        });
      const prev = sum(s.slice(0, 7));
      const cur = sum(s.slice(7));
      const rate = (x) => (x.hits + x.misses > 0 ? (x.hits / (x.hits + x.misses)) * 100 : null);
      return { cur, prev, rateCur: rate(cur), ratePrev: rate(prev) };
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
