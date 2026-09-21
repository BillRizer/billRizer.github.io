# billRizer.github.io

Blog pessoal de Pablo Telis, publicado com GitHub Pages + Jekyll.

## Estrutura

```text
_posts/             artigos em Markdown
_layouts/           layouts do site
_includes/          header e footer
assets/css/         design system e responsividade
assets/js/          tema, TOC, progresso e copy de código
assets/images/      imagens dos artigos
index.md            home
archive.md          arquivo de artigos (/artigos/)
about.md            página sobre (/sobre/)
```

## Criando um artigo

Crie um arquivo em `_posts` no formato:

```text
YYYY-MM-DD-slug-do-artigo.md
```

Front matter recomendado:

```yaml
---
layout: post
title: "Título"
description: "Resumo curto do artigo."
date: 2026-09-21 10:00:00 -0300
tags:
  - backend
  - architecture
reading_time: "8 min de leitura"
---
```

O índice lateral é gerado automaticamente a partir de `h2` e `h3`.

## Rodando localmente

Com Ruby instalado:

```bash
bundle install
bundle exec jekyll serve
```

Depois abra `http://localhost:4000`.

## Deploy

Este repositório foi mantido compatível com GitHub Pages. Basta substituir os arquivos do repositório, commitar e fazer push na branch publicada pelo Pages.
