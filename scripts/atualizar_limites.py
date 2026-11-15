"""Atualiza snapshot Natural Earth Map Units 1:50m, com fonte e hash públicos."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from urllib.request import urlopen

SOURCE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_map_units.geojson'
TARGET = Path(__file__).resolve().parents[1] / 'frontend/public/geo/countries-mapunits-ne50m.geojson'

def main():
    with urlopen(SOURCE, timeout=60) as response:
        raw = response.read()
    source = json.loads(raw)
    keep = ['GEOUNIT','GU_A3','ADMIN','NAME','NAME_EN','NAME_PT','NAME_LONG','FORMAL_EN','NAME_ALT','ADM0_A3','ISO_A2','ISO_A2_EH','ISO_A3']
    features = [{**feature, 'properties': {key: feature['properties'].get(key) for key in keep}} for feature in source['features']]
    result = {'type': 'FeatureCollection', 'metadata': {'source': SOURCE, 'retrieved_at': datetime.now(timezone.utc).isoformat(), 'source_sha256': hashlib.sha256(raw).hexdigest(), 'license': 'Public domain: https://www.naturalearthdata.com/about/terms-of-use/', 'scale': '1:50m', 'layer': 'Admin 0 map units'}, 'features': features}
    TARGET.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')))
    print(f'{len(features)} map units; source SHA256 {result["metadata"]["source_sha256"]}')
    for feature in features:
        if 'Guiana' in str(feature['properties']['GEOUNIT']):
            print(feature['properties'])

if __name__ == '__main__':
    main()
