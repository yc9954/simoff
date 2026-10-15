"""Stage 1 of the cycle: build a store space map from the data, and draw it.

The data has no floor plan or coordinates. What it does have, per store and week, is which product sat
in which kind of display (front end cap, mid-aisle end cap, rear end cap, in-aisle, secondary display,
front of store, ...) and what sold. So the map is a zone diagram, not a surveyed drawing:

  - aisles      one per department, ordered and sized by this store's sales share
  - displays    the display types this store actually used, each with a slot count = how many
                different products it carried in a typical (median) and a busy (90th pct) week
  - category    where each target product sits now: its shelf section, or the display it is on
  - positions   a fixed template places these zones (entrance and checkout at the front, end caps
                at both ends of the aisles); only the zones, counts and assignments come from data.
"""
import html

import numpy as np
import pandas as pd

from datasets import DISPLAY_CODES, MAILER_CODES

COLORS = {'A_front_endcap': '#3B73FF', 'C_other_display': '#88ACFA', 'none': '#B8BEC2', 'B_mailer_only': '#FCBB00'}
CODE_TO_COND = {'3': 'A_front_endcap', '0': 'none'}   # every other display code is C_other_display in the model


def code_condition(code):
    return CODE_TO_COND.get(str(code), 'C_other_display')


def build_map(t, p, pl, store_id, category, top_products, as_of_week, window=13, max_aisles=8):
    lo = as_of_week - window + 1
    ts = t[(t.store_id == store_id) & t.week.between(lo, as_of_week)].merge(p[['product_id', 'department', 'product_category']], on='product_id', how='left')
    if ts.empty:
        raise SystemExit(f'store {store_id} has no receipts in weeks {lo}-{as_of_week}')
    ps = pl[(pl.store_id == store_id) & pl.week.between(lo, as_of_week)]

    dept = ts.groupby(ts.department.replace('', 'Other').fillna('Other')).sales_value.sum().sort_values(ascending=False)
    share = dept / dept.sum()
    cat_dept = ts[ts.product_category == category].department.mode()
    cat_dept = cat_dept.iloc[0] if len(cat_dept) else share.index[0]
    keep = list(share.index[:max_aisles])
    if cat_dept not in keep:
        keep[-1] = cat_dept
    aisles = [{'id': f'aisle-{i + 1}', 'department': d, 'sales_share': round(float(share[d]), 4), 'category_home': d == cat_dept}
              for i, d in enumerate(keep)]
    other = float(share.drop(keep, errors='ignore').sum())

    # Display capacity: distinct products per display code per week at this store.
    def weekly(frame):
        g = frame[frame.display_location != '0'].groupby(['display_location', 'week']).product_id.nunique()
        out = {}
        for code in DISPLAY_CODES:
            if code == '0':
                continue
            s = g.xs(code, level=0) if code in g.index.get_level_values(0) else pd.Series(dtype=float)
            s = s.reindex(range(lo, as_of_week + 1), fill_value=0)
            out[code] = {'median': float(s.median()), 'p90': float(np.percentile(s, 90)), 'weeks_used': int((s > 0).sum())}
        return out
    cap_all = weekly(ps)
    cap_cat = weekly(ps[ps.product_id.isin(top_products)])
    displays = [{'code': c, 'label': DISPLAY_CODES[c], 'condition': code_condition(c),
                 'slots_all_median': cap_all[c]['median'], 'slots_all_p90': cap_all[c]['p90'],
                 'category_slots_median': cap_cat[c]['median'], 'category_slots_p90': cap_cat[c]['p90'],
                 'category_weeks_used': cap_cat[c]['weeks_used']}
                for c in cap_all if cap_all[c]['weeks_used'] > 0]

    # Where each target product is as of the last week.
    now = pl[(pl.store_id == store_id) & (pl.week == as_of_week) & pl.product_id.isin(top_products)]
    sold = ts[ts.product_id.isin(top_products)].groupby('product_id').basket_id.nunique()
    meta = p.set_index('product_id')
    products = []
    for i, pid in enumerate(top_products):
        r = now[now.product_id == pid]
        codes = sorted(set(r.display_location) - {'0'}, key=lambda c: (c != '3', c))
        code = codes[0] if codes else '0'
        mailer = sorted(set(r.mailer_location) - {'0'})
        products.append({'n': i + 1, 'product_id': pid, 'brand': str(meta.brand.get(pid, '')), 'type': str(meta.product_type.get(pid, '')),
                         'size': str(meta.package_size.get(pid, '')), 'display_code': code, 'display_label': DISPLAY_CODES.get(code, code),
                         'condition': code_condition(code), 'mailer': mailer[0] if mailer else '0',
                         'mailer_label': MAILER_CODES.get(mailer[0], mailer[0]) if mailer else MAILER_CODES['0'],
                         'visits_with_purchase_window': int(sold.get(pid, 0))})
    return {
        'schema': 'offline-sim-map/1', 'store_id': str(store_id), 'as_of_week': int(as_of_week), 'window_weeks': [int(lo), int(as_of_week)],
        'category': category, 'category_department': cat_dept,
        'store': {'visits': int(ts.basket_id.nunique()), 'visits_per_week': round(ts.basket_id.nunique() / window, 1),
                  'households': int(ts.household_id.nunique()), 'sales': round(float(ts.sales_value.sum()), 2),
                  'departments_not_drawn_share': round(other, 4)},
        'aisles': aisles, 'displays': displays, 'products': products,
        'capacity': {'A_front_endcap': _cap(displays, ['3']), 'C_other_display': _cap(displays, [c for c in DISPLAY_CODES if c not in ('0', '3')])},
        'provenance': {'zones': 'data: department sales share and display codes this store used',
                       'counts': 'data: distinct products per display type per week (median, 90th pct)',
                       'positions': 'template: no coordinates exist in the data'},
    }


def _cap(displays, codes):
    """Slots the target category can use: the most this store gave the category in a busy week (90th pct), at least 1."""
    rows = [d for d in displays if d['code'] in codes]
    return max(1, int(round(sum(d['category_slots_p90'] for d in rows)))) if rows else 1


# ---------------------------------------------------------------- drawing

def _esc(s):
    return html.escape(str(s), quote=True)


def render_svg(m, title, changes=None, layout=None):
    """Zone diagram. `layout` overrides each product's condition; `changes` = product ids to highlight."""
    changes = set(changes or [])
    W, H = 1200, 760
    x0, y0, w, h = 40, 90, 780, 560
    n = len(m['aisles'])
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" font-family="Pretendard, Instrument Sans, system-ui, sans-serif">',
           '<rect width="100%" height="100%" fill="#ffffff"/>',
           f'<text x="40" y="44" font-size="22" font-weight="600" fill="#000">{_esc(title)}</text>',
           f'<text x="40" y="70" font-size="12" fill="#4d5353">Store {_esc(m["store_id"])} · data from weeks {m["window_weeks"][0]}–{m["window_weeks"][1]} · {m["store"]["visits_per_week"]} visits per week · zone diagram (coordinates are a template; zones, slot counts and positions are data)</text>',
           f'<rect x="{x0}" y="{y0}" width="{w}" height="{h}" rx="6" fill="#f2f5f6" stroke="#d8dddf"/>']
    # rear wall band (code 2) and rear end caps (5)
    out.append(f'<rect x="{x0 + 10}" y="{y0 + 10}" width="{w - 20}" height="26" rx="3" fill="#edf0f2"/><text x="{x0 + 18}" y="{y0 + 28}" font-size="11" fill="#4d5353">Back wall of the store</text>')
    aisle_w = (w - 60) / n
    aisle_top, aisle_bot = y0 + 80, y0 + h - 170
    slots = {}
    for i, a in enumerate(m['aisles']):
        ax = x0 + 30 + i * aisle_w
        fill = '#ffffff' if not a['category_home'] else '#eef3ff'
        out.append(f'<rect x="{ax + 6}" y="{y0 + 46}" width="{aisle_w - 12}" height="24" rx="3" fill="#ffffff" stroke="#d8dddf"/>')   # rear end cap
        out.append(f'<rect x="{ax + 6}" y="{aisle_top}" width="{aisle_w - 12}" height="{aisle_bot - aisle_top}" rx="3" fill="{fill}" stroke="#d8dddf"/>')
        out.append(f'<text x="{ax + aisle_w / 2}" y="{aisle_top + 18}" font-size="11" text-anchor="middle" fill="#000">{_esc(a["department"][:12])}</text>')
        out.append(f'<text x="{ax + aisle_w / 2}" y="{aisle_top + 32}" font-size="10" text-anchor="middle" fill="#4d5353">{a["sales_share"] * 100:.0f}%</text>')
        out.append(f'<rect x="{ax + 6}" y="{aisle_bot + 8}" width="{aisle_w - 12}" height="28" rx="3" fill="#ffffff" stroke="#3B73FF" stroke-opacity=".5"/>')  # front end cap
        slots[('A', i)] = (ax + 10, aisle_bot + 14)
        if a['category_home']:
            slots['home'] = (ax + 10, aisle_top + 58, aisle_w - 20)
    out.append(f'<text x="{x0 + 18}" y="{aisle_bot + 52}" font-size="10" fill="#3B73FF">Front endcap row</text>')
    # front band: front-of-store display, secondary displays, entrance, checkout
    fy = y0 + h - 100
    out.append(f'<rect x="{x0 + 30}" y="{fy}" width="{w * .42}" height="34" rx="3" fill="#ffffff" stroke="#88ACFA"/><text x="{x0 + 38}" y="{fy + 21}" font-size="11" fill="#4d5353">Store front · secondary displays</text>')
    slots['C'] = (x0 + 150, fy + 6)
    out.append(f'<rect x="{x0 + 30}" y="{y0 + h - 50}" width="120" height="36" rx="3" fill="#000"/><text x="{x0 + 90}" y="{y0 + h - 27}" font-size="12" text-anchor="middle" fill="#fff">Entrance</text>')
    out.append(f'<rect x="{x0 + w - 230}" y="{y0 + h - 60}" width="200" height="46" rx="3" fill="#ffffff" stroke="#000"/><text x="{x0 + w - 130}" y="{y0 + h - 32}" font-size="12" text-anchor="middle">Checkout</text>')

    # product chips
    home_i = next(i for i, a in enumerate(m['aisles']) if a['category_home'])
    cond_of = {pr['product_id']: (layout or {}).get(pr['product_id'], pr['condition']) for pr in m['products']}
    groups = {'A_front_endcap': [], 'C_other_display': [], 'none': []}
    for pr in m['products']:
        groups[cond_of[pr['product_id']]].append(pr)

    def chip(x, y, pr, cond):
        ch = pr['product_id'] in changes
        stroke = '#0F766E' if ch else '#ffffff'
        sw = 3 if ch else 1
        s = f'<rect x="{x}" y="{y}" width="24" height="20" rx="4" fill="{COLORS[cond]}" stroke="{stroke}" stroke-width="{sw}"/>'
        s += f'<text x="{x + 12}" y="{y + 14}" font-size="10" text-anchor="middle" fill="{"#fff" if cond == "A_front_endcap" else "#000"}" font-weight="600">{pr["n"]}</text>'
        if pr['mailer'] != '0':
            s += f'<circle cx="{x + 22}" cy="{y + 2}" r="4" fill="{COLORS["B_mailer_only"]}" stroke="#fff"/>'
        return s
    # front end caps: start at the category's home aisle and spread outward
    order = sorted(range(n), key=lambda i: abs(i - home_i))
    per_cap = max(1, int((aisle_w - 20) // 27))
    for j, pr in enumerate(groups['A_front_endcap']):
        i = order[min(j // per_cap, n - 1)]
        x, y = slots[('A', i)]
        out.append(chip(x + (j % per_cap) * 27, y, pr, 'A_front_endcap'))
    for j, pr in enumerate(groups['C_other_display']):
        x, y = slots['C']
        out.append(chip(x + j * 27, y, pr, 'C_other_display'))
    hx, hy, hw = slots['home']
    per_row = max(1, int(hw // 27))
    out.append(f'<text x="{hx}" y="{hy - 4}" font-size="10" fill="#3B73FF">{_esc(m["category"])} shelf</text>')
    for j, pr in enumerate(groups['none']):
        out.append(chip(hx + (j % per_row) * 27, hy + 4 + (j // per_row) * 24, pr, 'none'))

    # legend
    lx = x0 + w + 30
    out.append(f'<text x="{lx}" y="{y0 + 6}" font-size="13" font-weight="600">{len(m["products"])} products</text>')
    for k, pr in enumerate(m['products']):
        y = y0 + 26 + k * 21
        cond = cond_of[pr['product_id']]
        mark = ' ←' if pr['product_id'] in changes else ''
        out.append(f'<rect x="{lx}" y="{y - 12}" width="18" height="15" rx="3" fill="{COLORS[cond]}"/><text x="{lx + 9}" y="{y - 1}" font-size="9" text-anchor="middle" fill="{"#fff" if cond == "A_front_endcap" else "#000"}">{pr["n"]}</text>')
        out.append(f'<text x="{lx + 26}" y="{y}" font-size="11" fill="#000">{_esc((pr["brand"] + " " + pr["type"].title())[:30])} {_esc(pr["size"])}{mark}</text>')
    ky = H - 40
    for k, (c, lab) in enumerate([('A_front_endcap', 'Front endcap'), ('C_other_display', 'Secondary display'), ('none', 'Regular shelf'), ('B_mailer_only', 'Flyer (dot)')]):
        out.append(f'<rect x="{40 + k * 150}" y="{ky}" width="14" height="14" rx="3" fill="{COLORS[c]}"/><text x="{60 + k * 150}" y="{ky + 12}" font-size="12">{lab}</text>')
    if changes:
        out.append(f'<rect x="{640}" y="{ky}" width="14" height="14" rx="3" fill="none" stroke="#0F766E" stroke-width="3"/><text x="{660}" y="{ky + 12}" font-size="12">Product that moves</text>')
    out.append('</svg>')
    return '\n'.join(out)
