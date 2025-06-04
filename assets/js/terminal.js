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
    'Programs must be written for people to read. – Harold Abelson'
  ];

  const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));

  const commands = {
    help() {
      print('Commands: help, quote, clear, ls, cd <link>, exit');
    },
    quote() {
      const q = quotes[Math.floor(Math.random() * quotes.length)];
      print(q);
    },
    clear() {
      output.innerHTML = '';
    },
    ls() {
      links.forEach(l => print(l));
    },
    cd(target) {
      if (!target) {
        print('Usage: cd <link>');
        return;
      }
      const match = links.find(l => l === target || l.startsWith(target));
      if (match) {
        localStorage.setItem('terminal-open', 'true');
        window.location.href = match;
      } else {
        print('No such link');
      }
    },
    exit() {
      toggle();
    }
  };

  commands.quit = commands.exit;

  function print(text) {
    const div = document.createElement('div');
    div.textContent = text;
    output.appendChild(div);
    output.scrollTop = output.scrollHeight;
  }

  function toggle(force) {
    const shouldShow = force !== undefined ? force : overlay.style.display !== 'block';
    if (shouldShow) {
      overlay.style.display = 'block';
      localStorage.setItem('terminal-open', 'true');
      input.focus();
    } else {
      overlay.style.display = 'none';
      localStorage.setItem('terminal-open', 'false');
    }
  }

  overlay.addEventListener('mousedown', function() {
    input.focus();
  });

  document.addEventListener('DOMContentLoaded', function() {
    if (localStorage.getItem('terminal-open') === 'true') {
      toggle(true);
    }
  });

  document.addEventListener('keydown', function(e) {
    if (e.key === '~' && !/input|textarea/i.test(e.target.tagName)) {
      e.preventDefault();
      toggle();
    } else if (e.key === 'Escape' && overlay.style.display === 'block') {
      e.preventDefault();
      toggle();
    }
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      const parts = input.value.trim().split(/\s+/);
      const cmd = parts.shift();
      if (cmd) {
        print('> ' + input.value.trim());
        if (commands[cmd]) {
          commands[cmd](parts.join(' '));
        } else {
          print('Unknown command');
        }
      }
      input.value = '';
    } else if (e.key === 'Escape') {
      toggle();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const current = input.value.trim();
      const pieces = current.split(/\s+/);
      if (pieces.length === 1) {
        const matches = Object.keys(commands).filter(c => c.startsWith(pieces[0]));
        if (matches.length === 1) {
          input.value = matches[0] + ' ';
        }
      } else if (pieces.length > 1) {
        const partial = pieces.pop();
        const matches = links.filter(l => l.startsWith(partial));
        if (matches.length === 1) {
          pieces.push(matches[0]);
          input.value = pieces.join(' ');
        } else if (matches.length > 1) {
          print(matches.join(' '));
        }
      }
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
