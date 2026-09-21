---
layout: page
permalink: /artigos/
title: Artigos
kicker: arquivo
description: Notas sobre problemas que encontrei, conceitos que precisei entender e decisões de arquitetura que vale a pena registrar.
---

<div class="archive-list">
{% for post in site.posts %}
  <article class="archive-item">
    <time datetime="{{ post.date | date_to_xmlschema }}">{{ post.date | date: "%Y.%m.%d" }}</time>
    <div>
      <h2><a href="{{ post.url | relative_url }}">{{ post.title }}</a></h2>
      <p>{{ post.description }}</p>
      <div class="tag-row">{% for tag in post.tags %}<span>#{{ tag }}</span>{% endfor %}</div>
    </div>
  </article>
{% endfor %}
</div>
