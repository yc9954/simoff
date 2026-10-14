"""Last stage of the cycle: choose where each product goes, under the store's real display capacity.

For every target product and every floor option (shelf / front end cap / other display) the
simulator's engine gives the expected sales over the horizon's visits. The store has a limited
number of display slots for the category (taken from the map: the most it gave the category in a
busy week). An assignment problem then picks the layout with the highest total, one place per
product. The flyer is not floor space, so every product keeps its mailer status.
"""
import numpy as np
from scipy.optimize import linear_sum_assignment

from sim import LABEL, Plan

OPTIONS = ['none', 'A_front_endcap', 'C_other_display']


def option_values(sched, engine, products):
    price = sched.product_id.map(products.shelf_price).to_numpy()
    pids = list(sched.product_id.unique())
    val = {}
    for o in OPTIONS:
        p = engine.predict(Plan(o, 'layout', layout={pid: o for pid in pids}).apply(sched))
        val[o] = sched.assign(units=p, revenue=p * price).groupby('product_id')[['units', 'revenue']].sum()
    return pids, val


def choose_layout(sched, engine, products, capacity, current, objective='revenue'):
    pids, val = option_values(sched, engine, products)
    cols = ['A_front_endcap'] * capacity['A_front_endcap'] + ['C_other_display'] * capacity['C_other_display'] + ['none'] * len(pids)
    V = np.array([[val[c].loc[pid, objective] for c in cols] for pid in pids])
    r, c = linear_sum_assignment(-V)
    layout = {pids[i]: cols[j] for i, j in zip(r, c)}
    table = []
    for pid in pids:
        base = val['none'].loc[pid]
        table.append({'product_id': pid, 'current': current.get(pid, 'none'), 'proposed': layout[pid],
                      'moved': layout[pid] != current.get(pid, 'none'),
                      **{f'{o}_units': float(val[o].loc[pid, 'units']) for o in OPTIONS},
                      **{f'{o}_revenue': float(val[o].loc[pid, 'revenue']) for o in OPTIONS},
                      'gain_units_vs_shelf': float(val[layout[pid]].loc[pid, 'units'] - base.units),
                      'gain_revenue_vs_shelf': float(val[layout[pid]].loc[pid, 'revenue'] - base.revenue)})
    table.sort(key=lambda r: -r['gain_revenue_vs_shelf'])
    moves = [{'product_id': r['product_id'], 'from': r['current'], 'to': r['proposed'],
              'from_label': LABEL[r['current']], 'to_label': LABEL[r['proposed']]} for r in table if r['moved']]
    return layout, table, moves
