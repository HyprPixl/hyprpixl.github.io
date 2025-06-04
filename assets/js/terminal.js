(function() {
  const overlay = document.createElement('div');
  overlay.id = 'terminal-overlay';
  overlay.innerHTML = '<div id="terminal-output"></div><input id="terminal-input" type="text" autocomplete="off" />';
  document.body.appendChild(overlay);

  const output = overlay.querySelector('#terminal-output');
  const input = overlay.querySelector('#terminal-input');

  const quotes = [
    'Talk is cheap. Show me the code. – Linus Torvalds',
    'Premature optimization is the root of all evil. – Donald Knuth',
    'Programs must be written for people to read. – Harold Abelson',
    'Always code as if the guy who ends up maintaining your code will be a violent psychopath. – John Woods'
  ];

  const commands = {
    help() {
      print('Commands: help, quote, clear, date, whoami');
    },
    quote() {
      const q = quotes[Math.floor(Math.random() * quotes.length)];
      print(q);
    },
    clear() {
      output.innerHTML = '';
    },
    date() {
      print(new Date().toString());
    },
    whoami() {
      print('guest');
    }
  };

  function print(text) {
    const div = document.createElement('div');
    div.textContent = text;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
  }

  function toggle() {
    if (overlay.style.display === 'block') {
      overlay.style.display = 'none';
    } else {
      overlay.style.display = 'block';
      input.focus();
    }
  }

  document.addEventListener('keydown', function(e) {
    if (e.key === '~' && !/input|textarea/i.test(e.target.tagName)) {
      e.preventDefault();
      toggle();
    }
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const cmd = input.value.trim();
      if (cmd) {
        print('> ' + cmd);
        if (commands[cmd]) {
          commands[cmd]();
        } else {
          print('Unknown command');
        }
      }
      input.value = '';
    } else if (e.key === 'Escape') {
      toggle();
    }
  });

  const link = document.createElement('a');
  link.id = 'terminalLink';
  link.href = '#';
  link.textContent = 'Terminal';
  link.addEventListener('click', function(e) {
    e.preventDefault();
    toggle();
  });
  document.body.appendChild(link);
})();
