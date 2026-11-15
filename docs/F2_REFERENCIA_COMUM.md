# F₂ com referência temporal comum — implementação e alternativas

Relatório de 15/11/2026. A implementação preserva os artefatos anteriores e não transforma o snapshot de 2025 em uma previsão atual. Nenhum arquivo original foi modificado.

O catálogo legado reúne referências de diferentes semanas de 2025. Somar suas previsões mistura instantes e climatologias diferentes. A nova rota `/forecast/selection` recompõe uma única semana t e os horizontes t+1 a t+4 para toda a seleção.

## Alternativas avaliadas

| Alternativa | Benefício | Limite e decisão |
| --- | --- | --- |
| Somar snapshots existentes | Implementação simples | Incoerência temporal; descartada. O endpoint legado permanece identificado. |
| Recalcular F₂ por célula com t comum e somar valores absolutos | Mantém identidade espacial e os pesos zonais, atende ponto/país/união e permite reconciliar a soma | **Implementada**, como extensão experimental. Climatologia e telemetria são recuperadas para a mesma referência; métricas antigas não são herdadas. |
| Um modelo novo para os totais de cada região | Pode aprender comportamento coletivo e dependência espacial | Exige definir regiões, novo treinamento e validação temporal; não foi apresentado como pronto. |
| Usar climatologia F₀ quando faltam entradas físicas úteis | Referência calculável sem fabricar FRP ou temperaturas | **Implementada como apoio explícito por célula**, com quantidade de células F₂/F₀ na resposta e na interface. Não equivale a inferência física F₂. |
| Apoio por persistência F₁ | Pode aproveitar atividade recente sem dados térmicos | Alternativa futura; requer comparar com F₀/F₂ e evitar escolher o método no mesmo conjunto usado para reportar desempenho final. |

## Contrato e método implementados

`POST /forecast/selection` recebe país opcional, IDs de células e data de referência. A data é normalizada para segunda-feira. A janela suportada é 01/01/2024 a 22/12/2025; o treinamento dos pesos usa 2012–2023. Datas anteriores não são apresentadas como retroprevisões sem uso de informação futura, e o arquivo não fornece entradas de 2026.

Os 36 Parquet regionais de 2012–2025 originam um cache semanal de **8.749.148 grupos**, com aproximadamente **1,5 GB**, separado em `data/global_1km_2000_2025/web_v2/f2/`. A construção medida levou 191,8 s. O cache tem assinatura das fontes, escrita atômica e bloqueio de construção. Não há download NASA na preparação.

Para cada célula: recuperar t e t−1; calcular climatologia local de 2012–2023 com vizinhança sazonal; obter as seis features físicas; aplicar pesos da zona climática; produzir quatro previsões. F₂ é usado com telemetria útil e disponibilidade de fontes; nas demais células processáveis, a projeção é F₀. Não são usadas as constantes térmicas ou de FRP do fallback legado do catálogo.

A seleção usa IDs deduplicados e filtro territorial sobre os registros. Previsões absolutas e climatologias são somadas. A anomalia agregada é calculada sobre esses totais, e não pela média das porcentagens. O risco regional permanece nulo: quantis e validação regional não foram inventados. A unidade continua atividade harmonizada de registros célula × mês × semana/sensor, não incêndios independentes nem área queimada.

A temperatura de fundo é uma aproximação derivada das médias 0,25°, com ponderação por contribuição de células, e não uma média bruta exata de medições. A disponibilidade informa arquivos globais e ausência de registros; não comprova observação de cada célula, céu sem nuvens ou completude territorial. Esses limites fazem parte da procedência.

Os filtros observacionais de sensores e a data do gráfico são independentes das entradas treinadas do F₂: o painel identifica sua referência e usa os sensores do modelo. Não se reaplicam pesos multissensores a um subconjunto diferente como se fosse o mesmo modelo.

## Cobertura e desempenho medidos

Na referência global de 22/12/2025, o cálculo processou **16.527 células**: **4.595 F₂** e **11.932 F₀**, sem imputações de FRP/temperatura. O histórico completo contém 16.610 células; a rota identifica as 83 sem histórico suficiente no arquivo de previsão como ausentes do cálculo, sem ocultá-las do universo selecionado. O catálogo legado de 16.525 pontos é outro artefato, preservado.

Foram materializados caches de resposta por país/IDs, referência, idioma e assinatura. Trocar o idioma reaproveita o resultado numérico e traduz sua procedência. A leitura para novas referências foi reduzida às semanas sazonais necessárias, mantendo o inventário de todas as células, inclusive as com zero registro naquela janela. Um teste compara numericamente essa leitura com a história completa.

Uma referência global nova (16/06/2025) levou **47,75 s** na primeira consulta medida, incluindo a preparação do inventário auxiliar; referências previamente calculadas usam o cache. Países e seleções pequenas são mais rápidos. Não foi demonstrado SLA de 2/5 segundos para F₂ global frio. Consultas observacionais e a interface continuam independentes dessa espera. Mudanças rápidas de filtro cancelam a espera do navegador; o cálculo servidor já iniciado pode terminar e popular o cache.

## Avaliação descritiva real

Amostra fixa de seis coordenadas, em diferentes continentes, e oito semanas de referência de março/junho/setembro/novembro de 2024 e 2025. Pesos não foram ajustados com os erros dessa amostra. O alvo é a atividade reconstruída no mesmo contrato do método, não área queimada, evento de incêndio ou observação independente de referência.

| Horizonte | MAE F₂ + apoio F₀ | MAE apenas F₀ | Skill relativo a F₀ |
| --- | ---: | ---: | ---: |
| 1 semana | 21,2308 | 26,1171 | +18,71% |
| 2 semanas | 24,1521 | 23,9007 | **−1,05%** |
| 3 semanas | 14,4029 | 14,9271 | +3,51% |
| 4 semanas | 24,1727 | 27,0117 | +10,51% |

São oito erros agregados por horizonte, **não validação global ou de cada país/célula**, e não substituem validação espacial/temporal ampla. O horizonte de duas semanas foi pior que F₀ nessa amostra. A interface mantém a identificação experimental, mostra F₀ e não exibe as métricas zonais legadas como se validassem a seleção.

Reprodução, na pasta `nasa-hackaton-repo/backend/`:

```bash
../../.venv/bin/python -m app.forecast_selection --build
../../.venv/bin/python -m app.forecast_selection --evaluate
../../.venv/bin/python -m unittest discover -s tests -p test_forecast_selection.py -v
```

A saída detalhada permanece em `data/global_1km_2000_2025/web_v2/f2/benchmark.json`. Próximas melhorias metodológicas: validar mais regiões e anos, investigar F₁ como apoio, revisar o merge temporal canônico e treinar/avaliar um método regional se a demonstração exigir uma previsão operacional.
