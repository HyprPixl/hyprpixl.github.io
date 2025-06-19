(function() {
  const overlay = document.createElement('div');
  overlay.id = 'terminal-overlay';
  overlay.innerHTML = '<div id="terminal-output"></div><input id="terminal-input" type="text" autocomplete="off" />';
  document.body.appendChild(overlay);

  const output = overlay.querySelector('#terminal-output');
  const input = overlay.querySelector('#terminal-input');
  const marquee = document.querySelector('marquee');
  const textFiles = ['bee-movie.txt'];

  if (marquee) {
    marquee.scrollAmount = 7;
  }

  const quotes = [
    'You cannot steer a ship thats not moving.',
    'There are dumpster fires everywhere for those with the eyes to see.',
    'There are cathedrals everywhere for those with the eyes to see',
    'Cynicism and nihilism are memetic traps.',
    'You never regret a swim',
    'It may not be your fault, but it is your problem'
  ];

  const links = Array.from(document.querySelectorAll('a[href]')).map(a => a.getAttribute('href'));

  const commands = {
    help() {
      let base = 'Commands: help, quote, clear, ls, cd <link>, pwd, date, whoami, echo <text>, fortune, exit';
      if (marquee) {
        base += ', scrolltext [file], speed <amount>';
      }
      print(base);
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
    pwd() {
      print(window.location.pathname);
    },
    date() {
      print(new Date().toString());
    },
    whoami() {
      print('guest');
    },
    echo(text) {
      print(text || '');
    },
    fortune() {
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const beginnings = ['Soon,', 'In a dream,', 'By the next full moon,', 'One day,', 'In the near future,'];
      const subjects = ['your code', 'a wandering cat', 'an old bug', 'a rogue AI', 'your rubber duck', 'an old friend', 'a talking cactus person'];
      const endings = [
        'will bring you great fortune.',
        'will test your patience.',
        'will lead you to a surprising discovery.',
        'will start making sense.',
        'will end something you care about.'
      ];
      const msg = `${pick(beginnings)} ${pick(subjects)} ${pick(endings)}`;
      const border = '_'.repeat(msg.length + 2);
      print(' ' + border);
      print('< ' + msg + ' >');
      print(' ' + '-'.repeat(msg.length + 2));
      print('........\\...^__^');
      print('.........\\..(oo)\\_______');
      print('............(__)\\........)\\/\\');
      print('................||----w.||');
      print('................||......||');
    },
    scrolltext(file) {
      if (!marquee) {
        print('This command is only available on the index page.');
        return;
      }
      if (!file) {
        print('Available files: ' + textFiles.join(' '));
        return;
      }
      const fname = file.endsWith('.txt') ? file : file + '.txt';
      fetch('assets/text/' + fname)
        .then(r => r.ok ? r.text() : Promise.reject())
        .then(text => {
          marquee.textContent = text;
        })
        .catch(() => {
          print('No such file');
        });
    },
    speed(val) {
      if (!marquee) {
        print('This command is only available on the index page.');
        return;
      }
      const n = parseInt(val, 10);
      if (isNaN(n)) {
        print('Usage: speed <number>');
        return;
      }
      marquee.scrollAmount = n;
      print('Text speed changed to ' + n);
    },
    exit() {
      toggle();
    }
  };

  commands.quit = commands.exit;
  if (marquee) {
    commands.read = commands.scrolltext;
  }

  function longestCommonPrefix(arr) {
    if (!arr.length) return '';
    let prefix = arr[0];
    for (let i = 1; i < arr.length; i++) {
      while (!arr[i].startsWith(prefix) && prefix) {
        prefix = prefix.slice(0, -1);
      }
      if (!prefix) break;
    }
    return prefix;
  }

  function print(text) {
    const div = document.createElement('div');
    div.textContent = text;
    output.appendChild(div);
    // wait for the DOM to update before scrolling
    setTimeout(() => {
      overlay.scrollTop = overlay.scrollHeight;
    }, 0);
  }

  function toggle(force) {
    const shouldShow = force !== undefined ? force : overlay.style.display !== 'block';
    if (shouldShow) {
      overlay.style.display = 'block';
      localStorage.setItem('terminal-open', 'true');
      overlay.scrollTop = overlay.scrollHeight;
      input.focus();
    } else {
      overlay.style.display = 'none';
      localStorage.setItem('terminal-open', 'false');
    }
  }

  overlay.addEventListener('click', function() {
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
          print('Unknown command, use "help" to see all commands');
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
        const partial = pieces[0];
        const matches = Object.keys(commands).filter(c => c.startsWith(partial));
        if (matches.length) {
          const prefix = longestCommonPrefix(matches);
          input.value = prefix;
          if (matches.length === 1) input.value += ' ';
          if (matches.length > 1 && prefix === partial) {
            print(matches.join(' '));
          }
        }
      } else if (pieces.length > 1) {
        const partial = pieces.pop();
        const matches = links.filter(l => l.startsWith(partial));
        if (matches.length) {
          const prefix = longestCommonPrefix(matches);
          pieces.push(prefix);
          input.value = pieces.join(' ');
          if (matches.length === 1) input.value += ' ';
          if (matches.length > 1 && prefix === partial) {
            print(matches.join(' '));
          }
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
