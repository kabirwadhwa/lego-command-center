/**
 * Real BrickEconomy markup, captured from the live site on 20 Nov 2026.
 *
 * The wrapper, heading and row markup is verbatim, including the two awkward
 * shapes that a naive parser gets wrong:
 *   - a label cell wrapped in <span class="helppopover"> (1-year growth)
 *   - a value cell containing a NESTED class="text-muted" (Pieces / PPP)
 *
 * These are fixtures of a third-party page, used only to prove our parser
 * reads them correctly. They are not market data and nothing is derived from
 * them at runtime.
 */

const row = (label: string, value: string) =>
  `<div class="row rowlist"><div class="col-xs-5 text-muted">${label}</div><div class="col-xs-7">${value}</div></div>`;

const box = (id: string, cls: string, title: string, rows: string[]) =>
  `<div id="${id}" class="side-box mt-30 ${cls}"><div class="side-box-head"><h3 class="set-h">${title}</h3></div>\n` +
  ` <div class="side-box-body position-relative">\n  ${rows.join("\n  ")}\n </div>\n</div>`;

/** Verbatim: value cell holds a nested text-muted element. */
const PIECES_ROW_10255 =
  '<div class="row rowlist"><div class="col-xs-5 text-muted">Pieces</div><div class="col-xs-7">4,002&nbsp;&nbsp;<span class="helppopover" help-content="The Price Per Piece (PPP) is the average cost per LEGO piece in the set."><small class="text-muted">(PPP €0.07)</small></span></div></div>';

/** Verbatim: label cell wrapped in a span. */
const ONE_YEAR_ROW_10255 =
  '<div class="row rowlist"><div class="col-xs-5 text-muted"><span class="helppopover" help-content="Next year growth represents the expected growth in the coming 12 months.">1-year growth</span></div><div class="col-xs-7">+5.48%&nbsp;&nbsp;<small class="text-muted">(12 month outlook)</small></div></div>';

/** Verbatim: value wrapped in <b>. */
const VALUE_NEW_ROW_10255 =
  '<div class="row rowlist"><div class="col-xs-5 text-muted">Value</div><div class="col-xs-7"><b>€320.59</b></div></div>';

/**
 * 10255-1 Assembly Square — retired, has a real RRP.
 * Includes the Subtheme Analysis box, whose "Annual growth" (+10.66%) is the
 * SUBTHEME's and must never be read as the set's (+7.20%).
 */
export const PAGE_10255 = [
  box("ContentPlaceHolder1_SetDetails", "setdetails", "Set Details", [
    row("Set number", "10255-1"),
    row("Name", "Assembly Square"),
    row("Theme", "Icons"),
    row("Subtheme", "Modular Buildings"),
    row("Year", "2017"),
    row("Released", "January 2, 2017"),
    row("Retired", "February 2024"),
    row("Availability", "Retired"),
    PIECES_ROW_10255,
    row("Minifigs", "9&nbsp;&nbsp;<small class=\"text-muted\">(Value €34.28)</small>"),
  ]),
  box("ContentPlaceHolder1_PanelSetPricing", "setpricing", "Set Pricing", [
    row("Retail price", "€299.99"),
    VALUE_NEW_ROW_10255,
    row("Growth", '<span class="text-green">+6.87%</span>'),
    row("Annual growth", '<span class="text-green">+7.20%</span>'),
    row("2025 growth", "+2.86%"),
    row("90-day change", "-3.77%"),
    ONE_YEAR_ROW_10255,
    row("Future growth", '+5.55%&nbsp;&nbsp;<small class="text-muted">(2-5 year outlook)</small>'),
    row("Value", "<b>€197.25</b>"),
    row("Range", "€171.84 - €236.70"),
  ]),
  box("ContentPlaceHolder1_SubthemeAnalysis", "", "Subtheme Analysis", [
    row("Sets", "14"),
    row("Years", "2013 - 2026"),
    row("Lifespan", '38 mos&nbsp;<small class="text-muted">(this set 85 mos)</small>'),
    row("Annual growth", '+10.66%&nbsp;<small class="text-muted">(this set +7.20%)</small>'),
  ]),
].join("\n");

/**
 * 40601-1 Majisto's Magical Workshop — gift-with-purchase.
 * `Retail price = Free promotional` and there is NO "Growth" row at all.
 */
export const PAGE_40601 = [
  box("ContentPlaceHolder1_SetDetails", "setdetails", "Set Details", [
    row("Set number", "40601-1"),
    row("Name", "Majisto's Magical Workshop"),
    row("Theme", "Icons"),
    row("Subtheme", "Castle"),
    row("Year", "2023"),
    row("Released", "November 18, 2023"),
    row("Retired", "November 20, 2023"),
    row("Availability", "Retired"),
    row("Pieces", "367"),
    row("Minifigs", "2&nbsp;&nbsp;<small class=\"text-muted\">(Value €15.92)</small>"),
  ]),
  box("ContentPlaceHolder1_PanelSetPricing", "setpricing", "Set Pricing", [
    row("Retail price", "Free promotional"),
    row("Value", "<b>€34.07</b>"),
    // No "Growth" row: there is no retail price to grow from.
    row("Annual growth", "+12.45%"),
    row("2025 growth", "+1.35%"),
    row("90-day change", "7.23%"),
    row("1-year growth", '+5.76%&nbsp;&nbsp;<small class="text-muted">(12 month outlook)</small>'),
    row("Future growth", "+5.63%"),
    row("Value", "<b>€23.27</b>"),
    row("Range", "€21.48 - €27.92"),
  ]),
].join("\n");

/** A set still on shelves: no secondary value published, Availability = Retail. */
export const PAGE_AT_RETAIL = [
  box("ContentPlaceHolder1_SetDetails", "setdetails", "Set Details", [
    row("Set number", "10330-1"),
    row("Name", "McLaren MP4/4 & Ayrton Senna"),
    row("Theme", "Icons"),
    row("Subtheme", "Vehicles"),
    row("Year", "2024"),
    row("Released", "March 1, 2024"),
    row("Retired", "-"),
    row("Availability", "Retail"),
    row("Pieces", "693"),
  ]),
  box("ContentPlaceHolder1_PanelSetPricing", "setpricing", "Set Pricing", [
    row("Retail price", "€79.99"),
    row("Annual growth", "+1.10%"),
  ]),
].join("\n");

/** USD page: must be refused rather than silently treated as EUR. */
export const PAGE_USD = [
  box("ContentPlaceHolder1_SetDetails", "setdetails", "Set Details", [
    row("Set number", "10255-1"),
    row("Name", "Assembly Square"),
    row("Availability", "Retired"),
  ]),
  box("ContentPlaceHolder1_PanelSetPricing", "setpricing", "Set Pricing", [
    row("Retail price", "$299.99"),
    row("Value", "<b>$341.20</b>"),
  ]),
].join("\n");

/** Search result page shape: canonical href carries the slug. */
export const SEARCH_10255 =
  '<div class="row"><h4><a href="/set/10255-1/lego-assembly-square">LEGO Assembly Square</a></h4></div>' +
  '<div class="row"><h4><a href="/set/10255-1/lego-assembly-square">dup</a></h4></div>';

/** Search that returns only a different set: must NOT be accepted. */
export const SEARCH_WRONG_SET =
  '<div class="row"><a href="/set/10256-1/lego-carousel">LEGO Carousel</a></div>';
