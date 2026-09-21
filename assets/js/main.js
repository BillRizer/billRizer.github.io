(function () {
  var root = document.documentElement;
  var toggle = document.querySelector('.theme-toggle');

  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.dataset.theme === 'light' ? 'dark' : 'light';
      root.dataset.theme = next;
      localStorage.setItem('theme', next);
    });
  }

  document.querySelectorAll('[data-current-year]').forEach(function (node) {
    node.textContent = new Date().getFullYear();
  });

  var article = document.querySelector('[data-article-content]');
  var toc = document.querySelector('[data-toc]');

  if (article && toc) {
    var headings = Array.prototype.slice.call(article.querySelectorAll('h2, h3'));

    headings.forEach(function (heading, index) {
      if (!heading.id) {
        heading.id = 'sec-' + (index + 1);
      }

      var link = document.createElement('a');
      link.href = '#' + heading.id;
      link.textContent = heading.textContent;
      link.className = heading.tagName === 'H3' ? 'toc-sub' : '';
      toc.appendChild(link);
    });
  }

  document.querySelectorAll('.prose pre').forEach(function (pre) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'copy-code';
    button.textContent = 'copiar';
    button.addEventListener('click', function () {
      var code = pre.querySelector('code');
      navigator.clipboard.writeText((code || pre).innerText).then(function () {
        button.textContent = 'copiado';
        window.setTimeout(function () { button.textContent = 'copiar'; }, 1400);
      });
    });
    pre.appendChild(button);
  });

  var progress = document.querySelector('.reading-progress span');
  if (progress && article) {
    var updateProgress = function () {
      var rect = article.getBoundingClientRect();
      var articleTop = window.scrollY + rect.top;
      var articleHeight = article.offsetHeight - window.innerHeight;
      var value = articleHeight > 0 ? ((window.scrollY - articleTop + 120) / articleHeight) * 100 : 0;
      progress.style.width = Math.max(0, Math.min(100, value)) + '%';
    };
    updateProgress();
    window.addEventListener('scroll', updateProgress, { passive: true });
  }
})();
