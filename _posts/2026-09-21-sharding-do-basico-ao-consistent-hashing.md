---
layout: post
title: "Sharding: do básico ao consistent hashing e virtual nodes"
description: "Como dividir dados entre vários shards sem transformar crescimento em hot shards, remapeamentos gigantes e queries cross-shard."
date: 2026-09-21 14:30:00 -0300
tags:
  - databases
  - distributed-systems
  - architecture
reading_time: "14 min de leitura"
image: /assets/images/sharding/consistent-hashing-add-node.png
---

Quando um banco começa a crescer, normalmente a primeira reação é **escalar verticalmente**: mais CPU, mais memória, disco melhor, índices melhores, queries melhores. E isso faz sentido por bastante tempo.

O problema é que existe um ponto em que um único nó começa a virar limite. Não só de armazenamento, mas de throughput, I/O, janela de manutenção e até risco operacional.

**Sharding** é uma forma de dividir horizontalmente os dados entre vários nós independentes. Em vez de todo mundo disputar o mesmo banco, cada shard fica responsável por uma parte dos dados.

A ideia é simples. A parte difícil é decidir **qual dado vai para qual shard** sem criar um problema pior que o original.

> Sharding não é “colocar mais bancos”. O que define se a solução funciona é a estratégia usada para distribuir e localizar os dados.

## Antes de tudo: sharding, partitioning e replication não são a mesma coisa

Esses termos aparecem juntos e é fácil misturar.

**Partitioning** é dividir um conjunto de dados em partes. Isso pode acontecer dentro do mesmo servidor ou entre servidores diferentes.

**Sharding** normalmente é usado quando essas partições estão distribuídas entre nós independentes. Cada shard possui apenas uma parte do dataset.

**Replication** resolve outro problema: manter cópias do mesmo dado em mais de um nó para disponibilidade, leitura ou disaster recovery.

Um sistema pode ter os dois ao mesmo tempo:

```text
Shard 1 -> primary + replicas
Shard 2 -> primary + replicas
Shard 3 -> primary + replicas
```

Nesse caso o sharding aumenta a capacidade horizontal e a replicação aumenta disponibilidade e/ou leitura.

## A decisão que manda no resto: shard key

Para distribuir os dados precisamos de uma **shard key** (ou partition key). Ela é o valor usado para descobrir onde um registro deve ficar.

Exemplos comuns:

```text
user_id
account_id
tenant_id
order_id
```

Uma boa shard key normalmente precisa equilibrar quatro coisas:

- **alta cardinalidade**, para termos muitos valores possíveis;
- **distribuição equilibrada**, para não concentrar carga em poucos shards;
- **afinidade com as queries**, para a aplicação saber qual shard consultar;
- **localidade útil**, quando dados que são usados juntos deveriam ficar juntos.

O último item é importante. Distribuir perfeitamente não adianta se toda query precisa consultar todos os shards.

Se quase tudo da minha aplicação é consultado por `user_id`, usar `user_id` como parte da estratégia pode ser ótimo porque os dados daquele usuário podem ficar juntos.

Agora imagine usar apenas `country` como shard key. Se 70% dos usuários estão no Brasil, provavelmente acabei de criar um shard gigante e vários quase vazios.

Esse desequilíbrio é o famoso **hot shard**.

## 1. Range-based sharding

A forma mais intuitiva é separar por faixas.

<figure>
  <img src="{{ '/assets/images/sharding/range-based.png' | relative_url }}" alt="Rabisco mostrando sharding por faixas, dividindo valores entre três shards">
  <figcaption>Range based: cada shard recebe uma faixa conhecida de valores.</figcaption>
</figure>

Podemos ter algo assim:

```text
Shard 1 -> user_id 0 até 999.999
Shard 2 -> user_id 1.000.000 até 1.999.999
Shard 3 -> user_id 2.000.000 até 2.999.999
```

Ou usar letras, datas, timestamps etc.

A vantagem é que a localização é muito barata. Se recebo `user_id = 1.500.000`, já sei exatamente para onde ir.

Range também é bom quando precisamos fazer consultas por intervalo porque valores próximos continuam próximos fisicamente.

O problema aparece quando a distribuição do tráfego não acompanha a distribuição das faixas.

Se a chave cresce monotonicamente, como um `created_at` ou um ID sequencial, todos os inserts novos podem cair no último shard. Nesse momento tenho vários servidores, mas um deles continua recebendo praticamente toda a escrita.

Outro problema é crescimento. Se uma faixa fica grande demais, preciso quebrá-la e mover uma parte dos dados.

Range-based é simples e útil, mas exige entender muito bem como os valores crescem e como são acessados.

## 2. Directory-based sharding

Outra opção é manter uma tabela que informa explicitamente onde cada chave está.

<figure>
  <img src="{{ '/assets/images/sharding/directory-based.png' | relative_url }}" alt="Rabisco mostrando uma tabela de diretório mapeando usuários para shards">
  <figcaption>Directory based: primeiro consultamos o mapa, depois acessamos o shard correto.</figcaption>
</figure>

Exemplo:

```text
shard_map
-----------------
user 7  -> shard 2
user 76 -> shard 1
user 22 -> shard 5
```

O fluxo fica próximo disso:

```text
request
  -> descobre shard no directory
  -> consulta o shard
  -> retorna o dado
```

A grande vantagem é **flexibilidade**. Eu posso mover o `user 7` do shard 2 para o shard 4 e atualizar o mapa sem mudar uma fórmula global.

Também consigo tratar casos especiais: clientes gigantes podem receber shards dedicados, tenants menores podem compartilhar nós, e a estratégia pode evoluir com o tempo.

Só que agora o directory virou infraestrutura crítica.

Se cada request precisar consultar essa tabela antes de acessar os dados, adicionamos latência e carga. Por isso normalmente aparece algum nível de cache na frente.

E se esse serviço ficar indisponível, posso ter todos os shards saudáveis e mesmo assim não saber onde os dados estão.

<div class="note">
<strong>trade-off</strong>
Directory based troca uma regra matemática simples por flexibilidade. O preço é operar um mecanismo de roteamento que também precisa ser rápido, consistente e altamente disponível.
</div>

## 3. Hash-based sharding

Uma alternativa muito comum é aplicar uma função de hash na chave.

<figure>
  <img src="{{ '/assets/images/sharding/hash-based.png' | relative_url }}" alt="Rabisco mostrando hash da chave módulo total de shards">
  <figcaption>Hash based: a função transforma a chave em um valor usado para escolher o shard.</figcaption>
</figure>

A versão mais simples seria:

<span class="equation">shard = hash(key) % total_de_shards</span>

Com 3 shards:

```text
hash(6823) % 3 = 1
```

Logo, a chave vai para o shard 1.

Uma boa função de hash tende a espalhar as chaves de forma mais uniforme. Isso ajuda bastante contra hotspots causados pelo formato natural da chave.

Mas existe uma pegadinha grande: **o número de shards faz parte da fórmula**.

Se eu passar de 3 para 4 shards, a conta de quase todas as chaves pode mudar.

```text
antes: hash(key) % 3
agora: hash(key) % 4
```

Ou seja, adicionar um shard pode exigir mover uma parte enorme do dataset.

Para cache isso significa muitas misses de uma vez. Para armazenamento persistente significa um rebalanceamento pesado.

Foi para diminuir esse impacto que consistent hashing ficou tão conhecido.

## Consistent hashing

No consistent hashing, em vez de usar diretamente `hash(key) % N`, imaginamos o espaço do hash como um **anel**.

<figure>
  <img src="{{ '/assets/images/sharding/consistent-hashing.png' | relative_url }}" alt="Rabisco de um anel de consistent hashing com três shards">
  <figcaption>A chave e os shards ocupam posições no mesmo espaço de hash.</figcaption>
</figure>

Vamos simplificar o espaço para `0..99`.

Os shards também recebem posições nesse anel:

```text
Shard 1 -> 0
Shard 2 -> 33
Shard 3 -> 66
```

Agora calculamos o hash da chave:

```text
hash(key) = 20
```

Percorremos o anel em uma direção definida, normalmente sentido horário, e usamos o primeiro shard encontrado.

Nesse exemplo, `20` cairia no `Shard 2`, que está em `33`.

O ponto importante não é o formato de círculo. O importante é que cada nó passa a ser responsável por um **intervalo do espaço de hash**.

### O que acontece quando entra um novo shard?

Imagine adicionar o `Shard 4` na posição `82`.

<figure>
  <img src="{{ '/assets/images/sharding/consistent-hashing-add-node.png' | relative_url }}" alt="Rabisco de consistent hashing mostrando a entrada de um quarto shard">
  <figcaption>Ao adicionar um nó, somente uma parte do anel troca de responsável.</figcaption>
</figure>

Agora somente as chaves do intervalo que passou a pertencer ao novo nó precisam mudar de lugar.

Com nós de capacidade equivalente e distribuição ideal, adicionar o quarto nó a um cluster de três tende a mover algo próximo de **1/4 das chaves**, em vez de recalcular praticamente todo o conjunto como no módulo simples.

Essa propriedade é o motivo do nome *consistent*: mudanças no conjunto de nós causam um remapeamento relativamente pequeno.

Mas o desenho com apenas uma posição por shard ainda possui um problema.

## O problema de usar apenas um ponto por shard

Olhe novamente para o anel. Se os pontos não estiverem perfeitamente espaçados, um shard pode ficar responsável por uma faixa muito maior que outro.

Com poucos nós isso é ainda mais visível.

Exemplo:

```text
Shard A -> posição 5
Shard B -> posição 12
Shard C -> posição 83
```

Um deles pode acabar responsável por um intervalo enorme do anel.

Também existe outro problema: se eu remover um nó, todo o intervalo daquele nó pode cair de uma vez em um único vizinho. O rebalanceamento deixa de ser tão suave quanto gostaríamos.

É aqui que entram os **virtual nodes**.

## Virtual nodes: vários pontos para o mesmo servidor

Um virtual node, ou **vnode**, é uma posição lógica no anel. Em vez de colocar cada servidor físico apenas uma vez, colocamos várias posições apontando para o mesmo servidor.

Imagine três servidores físicos:

```text
Shard A
Shard B
Shard C
```

Sem virtual nodes:

```text
A -> 10
B -> 40
C -> 75
```

Com virtual nodes poderíamos ter algo conceitualmente assim:

```text
A -> 03, 18, 44, 81
B -> 09, 27, 52, 90
C -> 14, 35, 67, 96
```

Continuam existindo apenas três servidores físicos. O que aumentou foi a quantidade de pontos distribuídos no anel.

Isso muda bastante o comportamento do cluster.

### 1. A distribuição tende a ficar mais uniforme

Se cada máquina possui dezenas ou centenas de posições espalhadas pelo anel, pequenos desequilíbrios entre um intervalo e outro tendem a se compensar.

Um vnode do `Shard A` pode receber uma faixa maior, enquanto outro vnode do mesmo servidor recebe uma faixa menor.

No agregado a distribuição fica mais estável.

### 2. Adicionar um servidor move pequenas faixas de vários nós

Imagine 3 servidores com 100 vnodes cada. Temos 300 posições lógicas distribuídas pelo anel.

Quando adicionamos o quarto servidor, podemos entregar a ele 100 novas posições.

Ele não precisa roubar um intervalo enorme de um único vizinho. Ele passa a assumir **pequenas faixas espalhadas pelo anel**, vindas de vários servidores existentes.

Resultado: o rebalanceamento tende a usar o cluster inteiro, em vez de sobrecarregar apenas dois nós.

### 3. Remover um servidor também distribui melhor o impacto

Se um servidor morrer, seus vnodes podem ser redistribuídos entre vários servidores restantes.

Sem vnodes, um único vizinho poderia herdar toda a faixa e receber um pico grande de armazenamento e tráfego.

### 4. Podemos representar máquinas com capacidades diferentes

Se um servidor possui o dobro da capacidade, uma implementação pode atribuir mais vnodes a ele.

Conceitualmente:

```text
server-small -> 100 vnodes
server-large -> 200 vnodes
```

Assim o servidor maior passa a receber uma parcela maior do espaço de hash.

<div class="note">
<strong>importante</strong>
Virtual node não é uma VM nem um processo separado. É uma unidade lógica de distribuição que aponta para um nó físico.
</div>

## Então consistent hashing resolve tudo?

Não.

Ele resolve muito bem o problema de **mapear chaves para nós com baixo custo de remapeamento quando o cluster muda**. Isso é extremamente útil em caches distribuídos, sistemas de storage e várias arquiteturas distribuídas.

Mas sharding continua tendo outros problemas.

### Queries cross-shard

Se a query não possui a shard key, talvez eu não saiba onde procurar.

Nesse caso posso ter que fazer um *scatter/gather*:

```text
query
  -> shard 1
  -> shard 2
  -> shard 3
  -> shard 4
  -> merge dos resultados
```

Isso aumenta latência, uso de rede e complexidade.

Por isso uma shard key boa não é apenas a que distribui bem. Ela também precisa fazer sentido para as queries importantes.

### Joins ficam mais caros

Um join dentro do mesmo banco é uma coisa. Um join entre dados que estão em máquinas diferentes pode virar tráfego de rede, processamento na aplicação ou duplicação de dados.

Em sistemas sharded é comum modelar os dados pensando em **data locality**.

Se duas entidades quase sempre são usadas juntas, talvez exista valor em mantê-las no mesmo shard.

### Transações distribuídas são mais complicadas

Uma transação em um shard é relativamente simples.

Uma operação que precisa ser atômica entre vários shards pode exigir protocolos e infraestrutura adicionais, ou uma mudança no desenho do domínio para evitar essa necessidade.

### Hot key continua existindo

Hash ajuda a espalhar muitas chaves, mas não divide magicamente uma chave extremamente quente.

Se um único `tenant_id` representa metade do tráfego e toda a informação dele precisa ficar junta, esse tenant ainda pode sobrecarregar o shard em que caiu.

Nesse caso talvez seja necessário mudar a granularidade da shard key, usar uma chave composta, separar workloads ou até dar infraestrutura dedicada para esse tenant.

## Um exemplo de escolha ruim de shard key

Imagine um SaaS multi-tenant.

A primeira ideia pode ser:

```text
shard_key = tenant_id
```

Isso é excelente para localização: toda query do tenant vai para um único lugar.

Mas existe uma condição escondida: **os tenants precisam ter tamanhos razoavelmente parecidos**.

Se existe um cliente 100x maior que os demais, ele pode criar um hot shard sozinho.

Uma evolução poderia ser algo como:

```text
shard_key = tenant_id + bucket
```

Onde grandes tenants podem ser divididos em múltiplos buckets enquanto tenants menores continuam simples.

Só que agora algumas queries do tenant precisam atingir mais de um bucket.

Novamente: resolvemos um problema e compramos outro. Arquitetura é quase sempre isso.

## Como eu pensaria a decisão na prática

Antes de escolher a estratégia eu tentaria responder:

1. Qual é o volume atual e qual crescimento realmente esperamos?
2. O gargalo é storage, escrita, leitura, CPU, I/O ou conexão?
3. Quais são as 5 queries mais importantes?
4. Elas sempre conhecem uma chave que pode rotear para um shard?
5. Existem chaves muito maiores ou muito mais quentes que as outras?
6. Precisamos de range queries eficientes?
7. Com que frequência nós entram e saem do cluster?
8. Quanto dado podemos mover durante um rebalanceamento?
9. O que acontece com joins e transações que hoje são locais?
10. Como backup, restore, observabilidade e migrations vão funcionar em N bancos?

Se eu não consigo responder essas perguntas, provavelmente ainda é cedo para escolher a fórmula de sharding.

## Quando eu evitaria sharding

Sharding adiciona bastante complexidade operacional. Então eu não usaria só porque a aplicação “pode crescer”.

Antes eu tentaria esgotar opções mais baratas:

- corrigir queries ruins;
- criar índices corretos;
- remover N+1;
- usar cache onde faz sentido;
- separar leitura com replicas;
- particionar tabelas localmente;
- arquivar dados frios;
- escalar verticalmente enquanto o custo ainda for razoável.

Um banco grande em uma máquina forte costuma ser muito mais simples de operar do que dez bancos pequenos com routing, rebalanceamento, backup, migrations e observabilidade distribuída.

## Resumindo

A evolução das estratégias fica mais clara quando olhamos qual problema cada uma tenta resolver:

```text
Range based
  simples e bom para intervalos
  -> pode gerar hotspots e exige rebalanceamento de faixas

Directory based
  flexível e explícito
  -> adiciona um serviço/tabela crítica de roteamento

Hash % N
  simples e distribui bem
  -> mudar N remapeia dados demais

Consistent hashing
  reduz o remapeamento quando nós mudam
  -> poucos pontos ainda podem gerar distribuição desigual

Consistent hashing + virtual nodes
  distribui vários pontos por servidor
  -> melhora balanceamento e suaviza rebalancing
```

O principal para mim é não começar pelo algoritmo. **Primeiro vem a shard key e o padrão de acesso**.

Se as queries mais importantes já sabem exatamente qual shard acessar, a arquitetura começa bem. Se quase tudo precisa fazer fan-out em todos os shards, provavelmente a distribuição está bonita no diagrama e cara na aplicação.
