# Cartografia usada na interface

`countries-mapunits-ne50m.geojson` é um snapshot da camada **Natural Earth Admin 0 Map Units, escala 1:50m**, obtido em 15/11/2026. São 265 feições com unidades territoriais separadas, incluindo Guiana Francesa, Guadalupe, Martinica, Mayotte e Reunião. O campo `metadata` registra URL, data, licença e SHA-256 do arquivo público de origem. As geometrias foram preservadas e as propriedades usadas na interface foram selecionadas.

Fonte: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson

Licença: domínio público, conforme https://www.naturalearthdata.com/about/terms-of-use/ . A escolha de Map Units para distinguir territórios ultramarinos é descrita na página oficial https://www.naturalearthdata.com/downloads/50m-cultural-vectors/50m-admin-0-countries-2/ . Os limites são generalizados, estáticos e representam a convenção de facto da fonte; alterar o ano das observações não altera as fronteiras.

Reprodução: na raiz principal, `.venv/bin/python nasa-hackaton-repo/scripts/atualizar_limites.py`. Esse comando exige rede; a aplicação usa o snapshot local, sem download em tempo de execução. O hash fixa a origem efetivamente consultada, sem atribuir uma versão de lançamento não confirmada no arquivo.

Os arquivos anteriores `countries.geojson` (legado sem procedência registrada) e `countries-ne50m.geojson` (Admin 0 Countries com 242 feições) foram preservados, mas não são carregados pela aplicação. A busca usa os rótulos reais dos registros FIRMS; `resolveCountryShape` aplica aliases explícitos, sem incorporar silenciosamente os dados de um território a outro. Nomes sem geometria correspondente continuam disponíveis nas consultas e não recebem um polígono inventado.
