/**
 * Seletor de duração de bloco: botões de preset + campo para digitar na hora.
 *
 * Existe como componente porque as três superfícies (painel do TEC, janela do
 * contador, popup) mostram exatamente o mesmo controle. Antes havia três
 * funções quase idênticas montando os botões — é assim que as superfícies
 * começam a divergir de comportamento sem ninguém perceber.
 *
 * Sem estado: o campo nunca guarda o último valor, por decisão de projeto.
 */
(function (root) {
  const RC = (root.RC = root.RC || {});

  RC.blockPicker = {
    /**
     * @param container  elemento onde montar (é esvaziado)
     * @param presets    lista de minutos dos botões
     * @param onPick     recebe os minutos já validados
     */
    render(container, presets, onPick) {
      if (!container) return;
      container.innerHTML = '';

      for (const min of presets && presets.length ? presets : [45, 56, 75]) {
        const b = document.createElement('button');
        b.className = 'preset';
        b.type = 'button';
        b.textContent = `${min}min`;
        b.addEventListener('click', () => onPick(min));
        container.appendChild(b);
      }

      const input = document.createElement('input');
      input.className = 'preset-input';
      input.type = 'number';
      input.min = '1';
      input.max = String(RC.timer.MAX_MINUTES);
      input.placeholder = 'min';
      input.title = `Digite os minutos e aperte Enter (até ${RC.timer.MAX_MINUTES})`;
      input.setAttribute('aria-label', 'Duração do bloco em minutos');

      const submit = () => {
        const minutes = RC.timer.normalizeMinutes(input.value);
        if (minutes == null) {
          // Valor impossível: sinaliza no próprio campo e não inicia nada.
          input.value = '';
          input.classList.add('invalid');
          setTimeout(() => input.classList.remove('invalid'), 600);
          input.focus();
          return;
        }
        input.value = '';
        onPick(minutes);
      };

      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          submit();
        }
      });

      const go = document.createElement('button');
      go.className = 'preset preset-go';
      go.type = 'button';
      go.textContent = '▶';
      go.title = 'Iniciar com a duração digitada';
      go.addEventListener('click', submit);

      container.append(input, go);
    },
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
