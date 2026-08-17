# LEGO Command Center Accounting Standards & Null Propagation

This document defines the strict accounting standards, formulas, and null propagation rules implemented in the LEGO Command Center to prevent data fabrication and ensure absolute financial truthfulness.

---

## 1. Inventory Valuation (Weighted Moving Average Cost)

The system dynamically computes the unit acquisition cost basis of inventory items using the **Weighted Moving Average Cost** model.

### Formula
Whenever stock is added to a balance (via Purchase, Import, or Positive Adjustment):

\[
C_{new} = \frac{(Q_{old} \times C_{old}) + (Q_{added} \times C_{added})}{Q_{old} + Q_{added}}
\]

Where:
* \(Q_{old}\): Previous stock quantity
* \(C_{old}\): Previous weighted average cost basis
* \(Q_{added}\): Added stock quantity
* \(C_{added}\): Acquisition cost of the added stock

### Null Propagation (Unknown Cost Basis)
If the acquisition cost is unknown:
1. **Unknown added cost (\(C_{added} = \text{null}\))**:
   * If there was an existing known average cost (\(C_{old} \neq \text{null}\)), the new average cost basis **preserves** the existing cost basis (\(C_{new} = C_{old}\)) instead of averaging in \(0.00\) (which would fabricate a lower cost basis and inflate margins).
   * If the existing cost basis was also unknown (\(C_{old} = \text{null}\)), the new average cost basis remains **unknown** (\(C_{new} = \text{null}\)).
2. **Unknown previous cost (\(C_{old} = \text{null}\)) and known added cost (\(C_{added} \neq \text{null}\))**:
   * The new average cost basis becomes the added cost (\(C_{new} = C_{added}\)).

---

## 2. Order Reconciliation & Profitability

### Net Settled Revenue
Net settled revenue represents the actual cash received from a sale after transaction fees, shipping costs, and discounts:

\[
R_{net} = R_{gross} - F_{marketplace} - S_{shipping} - D_{discount}
\]

Where:
* \(R_{gross}\): Gross revenue (order total)
* \(F_{marketplace}\): Marketplace transaction fees (e.g. payment gateway fees, Shopify fees)
* \(S_{shipping}\): Seller-paid shipping costs
* \(D_{discount}\): Customer discount applied

**Null Propagation**:
If \(F_{marketplace}\) is unknown (\(\text{null}\)):
* The net revenue cannot be calculated precisely and becomes **unknown** (\(R_{net} = \text{null}\)).

### Gross Profit & Margin
Profitability metrics are derived directly from known sale properties and the unit cost basis:

\[
P = R_{net} - C_{cogs}
\]
\[
M = \frac{P}{R_{gross}} \times 100\%
\]

Where:
* \(P\): Gross Profit
* \(M\): Operating Margin
* \(C_{cogs}\): Cost of Goods Sold (\(\sum Q_{item} \times C_{unitCostAtSale}\))

**Null Propagation**:
* If either \(R_{net}\) or \(C_{cogs}\) is unknown (\(\text{null}\)):
  * Profit becomes **unavailable/unknown** (\(P = \text{null}\)).
  * Margin becomes **unavailable/unknown** (\(M = \text{null}\)).
  * The user interface displays explicit warnings rather than showing a fabricated 100% margin or 0.00 profit.
* Genuinely free items (cost basis = \(0.00\)) and free transactions (fee = \(0.00\)) remain fully supported and are calculated with standard mathematical rules.
