import zipfile
import xml.etree.ElementTree as ET
import json
import os
from datetime import datetime, timedelta

excel_path = "/Users/kabirwadhwa/Downloads/test inverntory.xlsx"
out_json_path = os.path.join(os.path.dirname(__file__), "../prisma/inventory-seed.json")

print(f"Reading {excel_path}...")

with zipfile.ZipFile(excel_path) as z:
    shared_strings = []
    if 'xl/sharedStrings.xml' in z.namelist():
        tree = ET.fromstring(z.read('xl/sharedStrings.xml'))
        for si in tree.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}si'):
            texts = [elem.text for elem in si.iter('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t') if elem.text]
            shared_strings.append(''.join(texts))
    
    sheet_tree = ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    sheet_data = sheet_tree.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}sheetData')
    
    rows = []
    for row in sheet_data.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}row')[1:]:
        row_dict = {}
        for c in row.findall('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}c'):
            col = ''.join([ch for ch in c.get('r') if ch.isalpha()])
            t = c.get('t')
            v = c.find('{http://schemas.openxmlformats.org/spreadsheetml/2006/main}v')
            val = v.text if v is not None else ''
            if t == 's' and val:
                val = shared_strings[int(val)]
            row_dict[col] = val
        
        lot_id = row_dict.get('A', '').strip()
        set_num = row_dict.get('B', '').strip()
        name = row_dict.get('C', '').strip()
        qty_str = row_dict.get('D', '1').strip()
        date_str = row_dict.get('E', '').strip()
        supplier = row_dict.get('F', '').strip()
        cost_str = row_dict.get('G', '').strip()
        vat = row_dict.get('H', '').strip()
        status = row_dict.get('L', 'AVAILABLE').strip()
        ownership = row_dict.get('M', '').strip().upper() # COMPANY or PRIVATE
        
        if not set_num or not name:
            continue
            
        try:
            qty = int(float(qty_str))
        except:
            qty = 1
            
        try:
            cost = round(float(cost_str), 2) if cost_str else 0.0
        except:
            cost = 0.0
            
        # Parse excel date serial number if present
        date_val = None
        if date_str:
            try:
                # Excel base date is 1899-12-30
                serial = float(date_str)
                base = datetime(1899, 12, 30)
                date_val = (base + timedelta(days=serial)).strftime("%Y-%m-%d")
            except:
                date_val = None

        if not ownership or ownership == "Ownership":
            ownership = "COMPANY"
        elif "PRIV" in ownership:
            ownership = "PRIVATE"
        else:
            ownership = "COMPANY"

        rows.append({
            "lotId": lot_id or f"LOT-{set_num}",
            "setNumber": set_num,
            "setName": name,
            "quantity": max(1, qty),
            "purchaseDate": date_val or "2026-01-15",
            "supplier": supplier or "Wholesale Partner",
            "unitCost": cost,
            "vatRegime": vat if vat in ["INVOICE", "MARGIN"] else "INVOICE",
            "ownership": ownership,
            "status": status or "AVAILABLE"
        })

print(f"Extracted {len(rows)} valid inventory lines across {len(set(r['setNumber'] for r in rows))} unique sets.")

with open(out_json_path, "w", encoding="utf-8") as f:
    json.dump(rows, f, indent=2)

print(f"Saved to {out_json_path}")
