// keypad.js
// Keypad / secret-archive logic

(function() {
  const keypad  = document.getElementById("keypad");
  const display = document.getElementById("codeDisplay");
  let input = "";

  // Grab the first A–Z letter of each reading link
  const initials = [...document.querySelectorAll(".reading-sidebar ul li a")]
    .map(a => (a.textContent.match(/[A-Za-z]/) || [""])[0].toUpperCase());

  // Build ASCII code string
  const asciiStr = initials.map(ch => ch.charCodeAt(0)).join("");

  // XOR-obfuscate (numbers only)
  const key = 37;  // you can change this if you like
  const obf = [...asciiStr].map(c => c.charCodeAt(0) ^ key);

  function addDigit(d) {
    // Cap input at 4 digits
    if (input.length >= 4) {
      return;
    }
    input += d;
    display.textContent = input;
    if (input.length === 4) {
      checkAttempt();
    }
  }

  function checkAttempt() {
    // de-obfuscate on the fly
    const target = obf.map(n => String.fromCharCode(n ^ key)).join("");
    // Only check the first 4 digits of the target
    const targetFirst4 = target.slice(0, 4);
    const attempt = input.slice(0, 4);
    if (attempt === targetFirst4) {
      window.location.href = "/pages/classified-archive.html";
    }
  }

  // Build keypad buttons 1–9, 0 and backspace
  for (let i = 1; i <= 9; i++) {
    const b = document.createElement("button");
    b.textContent = i;
    b.onclick = () => addDigit(i);
    keypad.appendChild(b);
  }

  const zero = document.createElement("button");
  zero.textContent = "0";
  zero.onclick = () => addDigit(0);
  keypad.appendChild(zero);

  const back = document.createElement("button");
  back.textContent = "⌫";
  back.onclick = () => {
    input = input.slice(0, -1);
    display.textContent = input;
  };
  keypad.appendChild(back);
})();
