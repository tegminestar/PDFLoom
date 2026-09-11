// Regenerates the bundled form templates in apps/web/public/templates/.
// Run with: pnpm --filter @pdfloom/web generate:templates
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "templates");

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

const INK = rgb(0.11, 0.11, 0.13);
const FAINT = rgb(0.45, 0.45, 0.48);
const FIELD_BORDER = rgb(0.6, 0.6, 0.63);

/** Small page-builder: tracks a cursor and lays out paragraphs/labels/fields top-down, adding new pages as needed. */
class Doc {
  constructor(doc, regular, bold) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.form = doc.getForm();
    this.page = doc.addPage([PAGE_W, PAGE_H]);
    this.y = PAGE_H - MARGIN;
  }

  ensureSpace(h) {
    if (this.y - h < MARGIN) {
      this.page = this.doc.addPage([PAGE_W, PAGE_H]);
      this.y = PAGE_H - MARGIN;
    }
  }

  title(text) {
    this.ensureSpace(30);
    this.page.drawText(text, { x: MARGIN, y: this.y - 20, size: 20, font: this.bold, color: INK });
    this.y -= 34;
  }

  heading(text) {
    this.ensureSpace(22);
    this.page.drawText(text, { x: MARGIN, y: this.y - 12, size: 12, font: this.bold, color: INK });
    this.y -= 22;
  }

  wrapLines(text, font, size, maxWidth) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      let current = "";
      for (const word of paragraph.split(" ")) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
          lines.push(current);
          current = word;
        } else {
          current = candidate;
        }
      }
      lines.push(current);
    }
    return lines;
  }

  paragraph(text, { size = 9.5, color = INK, gap = 10 } = {}) {
    const lines = this.wrapLines(text, this.regular, size, CONTENT_W);
    for (const line of lines) {
      this.ensureSpace(size + 4);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font: this.regular, color });
      this.y -= size * 1.35;
    }
    this.y -= gap;
  }

  spacer(h = 8) {
    this.y -= h;
  }

  rule() {
    this.ensureSpace(12);
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.75, color: rgb(0.82, 0.82, 0.84) });
    this.y -= 14;
  }

  /** One or more text-field "cells" on the same row, each with its own label above it. cells: [{name,label,width,multiline?}] */
  fieldRow(cells, { height = 20, defaultValue } = {}) {
    // Catches a whole class of bug at generation time instead of only via a
    // rendered screenshot: cell widths + inter-cell gaps (12pt each) summing
    // past CONTENT_W runs the rightmost box off the page edge. A few points
    // of overflow is cosmetically fine (existing templates already have
    // some); flagged only once it's large enough to actually clip a field.
    const totalWidth = cells.reduce((sum, c) => sum + c.width, 0) + 12 * (cells.length - 1);
    if (totalWidth > CONTENT_W + 20) {
      console.warn(`fieldRow overflow: [${cells.map((c) => c.name).join(", ")}] totals ${totalWidth}pt, page content width is ${CONTENT_W}pt`);
    }
    // Compute the tallest box in the row up front — a multiline cell's box
    // is taller than the row's base `height`, and sizing it after picking
    // rowY makes the box grow *upward* past the label into whatever was
    // drawn above the row (caught via a rendered-screenshot review).
    const tallest = Math.max(...cells.map((c) => (c.multiline ? height * 2.4 : height)));
    this.ensureSpace(tallest + 14);
    const labelY = this.y - 8;
    const rowY = this.y - tallest - 12;
    let x = MARGIN;
    for (const cell of cells) {
      this.page.drawText(cell.label, { x, y: labelY, size: 8, font: this.bold, color: FAINT });
      const field = this.form.createTextField(cell.name);
      if (defaultValue !== undefined) field.setText(defaultValue);
      if (cell.multiline) field.enableMultiline();
      const boxHeight = cell.multiline ? height * 2.4 : height;
      field.addToPage(this.page, {
        x,
        y: rowY + (tallest - boxHeight), // align box tops within the row when heights differ
        width: cell.width,
        height: boxHeight,
        borderColor: FIELD_BORDER,
        borderWidth: 1,
        font: this.regular,
      });
      x += cell.width + 12;
    }
    this.y = rowY - 6;
  }

  dropdownRow(name, label, options, { width = CONTENT_W, height = 20 } = {}) {
    this.ensureSpace(height + 14);
    this.page.drawText(label, { x: MARGIN, y: this.y - 8, size: 8, font: this.bold, color: FAINT });
    const rowY = this.y - height - 12;
    const field = this.form.createDropdown(name);
    field.addOptions(options);
    field.select(options[0]);
    field.addToPage(this.page, { x: MARGIN, y: rowY, width, height, borderColor: FIELD_BORDER, borderWidth: 1, font: this.regular });
    this.y = rowY - height - 6;
  }

  checkboxRow(name, label) {
    this.ensureSpace(24);
    const box = this.form.createCheckBox(name);
    box.addToPage(this.page, { x: MARGIN, y: this.y - 16, width: 14, height: 14, borderColor: FIELD_BORDER, borderWidth: 1 });
    this.page.drawText(label, { x: MARGIN + 22, y: this.y - 14, size: 9.5, font: this.regular, color: INK });
    this.y -= 26;
  }

  radioRow(name, label, options) {
    this.ensureSpace(24);
    this.page.drawText(label, { x: MARGIN, y: this.y - 8, size: 8, font: this.bold, color: FAINT });
    const rowY = this.y - 28;
    let x = MARGIN;
    const group = this.form.createRadioGroup(name);
    for (const opt of options) {
      group.addOptionToPage(opt, this.page, { x, y: rowY, width: 14, height: 14, borderColor: FIELD_BORDER, borderWidth: 1 });
      this.page.drawText(opt, { x: x + 20, y: rowY + 2, size: 9, font: this.regular, color: INK });
      x += 20 + this.regular.widthOfTextAtSize(opt, 9) + 24;
    }
    this.y = rowY - 10;
  }

  signatureBlock(labelA, labelB) {
    this.ensureSpace(70);
    const colW = (CONTENT_W - 24) / 2;
    this.fieldRow([
      { name: `${labelA.toLowerCase().replace(/\s+/g, "_")}_signature`, label: `${labelA} — Signature (type full name)`, width: colW },
      { name: `${labelB.toLowerCase().replace(/\s+/g, "_")}_signature`, label: `${labelB} — Signature (type full name)`, width: colW },
    ]);
    this.fieldRow([
      { name: `${labelA.toLowerCase().replace(/\s+/g, "_")}_date`, label: "Date", width: colW },
      { name: `${labelB.toLowerCase().replace(/\s+/g, "_")}_date`, label: "Date", width: colW },
    ]);
  }

  disclaimer(text) {
    this.spacer(6);
    this.rule();
    this.paragraph(text, { size: 7.5, color: FAINT, gap: 0 });
  }
}

async function build(builderFn) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const d = new Doc(doc, regular, bold);
  await builderFn(d);
  return doc.save();
}

const GENERIC_DISCLAIMER =
  "Template provided for general reference only and does not constitute legal advice. Laws vary by jurisdiction — have a qualified professional review this document before you sign or rely on it.";

// --- 1. Mutual NDA ----------------------------------------------------------
async function mutualNda() {
  return build((d) => {
    d.title("Mutual Non-Disclosure Agreement");
    d.paragraph(
      'This Mutual Non-Disclosure Agreement ("Agreement") is entered into as of the Effective Date below by and between the two parties identified below (each a "Party" and together the "Parties"), in connection with a possible business relationship between them (the "Purpose").',
    );
    d.fieldRow([{ name: "effective_date", label: "Effective Date", width: 200 }]);
    d.heading("Party A");
    d.fieldRow([
      { name: "party_a_name", label: "Full Legal Name", width: 260 },
      { name: "party_a_address", label: "Address", width: 220 },
    ]);
    d.heading("Party B");
    d.fieldRow([
      { name: "party_b_name", label: "Full Legal Name", width: 260 },
      { name: "party_b_address", label: "Address", width: 220 },
    ]);
    d.paragraph(
      '1. Confidential Information. "Confidential Information" means any non-public information disclosed by either Party, whether orally, in writing, or by any other means, that is designated as confidential or that a reasonable person would understand to be confidential given the nature of the information and the circumstances of disclosure.',
    );
    d.paragraph(
      "2. Obligations. Each Party agrees to (a) hold the other Party's Confidential Information in strict confidence, (b) not disclose it to any third party without prior written consent, and (c) use it solely for the Purpose.",
    );
    d.paragraph(
      "3. Exclusions. Confidential Information does not include information that is or becomes publicly available through no fault of the receiving Party, was already known to the receiving Party without an obligation of confidentiality, or is independently developed without use of the disclosing Party's Confidential Information.",
    );
    d.dropdownRow("term_length", "Term of Confidentiality Obligation", ["1 year", "2 years", "3 years", "5 years"], { width: 200 });
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.paragraph("IN WITNESS WHEREOF, the Parties have executed this Agreement as of the Effective Date above.");
    d.signatureBlock("Party A", "Party B");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 2. Simple Invoice -------------------------------------------------------
async function simpleInvoice() {
  return build((d) => {
    d.title("Invoice");
    d.fieldRow([
      { name: "invoice_number", label: "Invoice #", width: 140 },
      { name: "invoice_date", label: "Date", width: 140 },
      { name: "due_date", label: "Due Date", width: 140 },
    ]);
    d.heading("From");
    d.fieldRow([{ name: "from_business", label: "Business Name", width: CONTENT_W }]);
    d.fieldRow([{ name: "from_address", label: "Address", width: CONTENT_W }]);
    d.heading("Bill To");
    d.fieldRow([{ name: "bill_to_name", label: "Client Name", width: CONTENT_W }]);
    d.fieldRow([{ name: "bill_to_address", label: "Address", width: CONTENT_W }]);
    d.heading("Line Items");
    const colWidths = [232, 60, 90, 90];
    const colLabels = ["Description", "Qty", "Rate", "Amount"];
    for (let row = 1; row <= 5; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `item_${row}_${label.toLowerCase()}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 18 },
      );
    }
    d.fieldRow([
      { name: "subtotal", label: "Subtotal", width: 140 },
      { name: "tax", label: "Tax", width: 140 },
      { name: "total", label: "Total Due", width: 140 },
    ]);
    d.fieldRow([{ name: "notes", label: "Notes", width: CONTENT_W, multiline: true }]);
    d.dropdownRow("payment_terms", "Payment Terms", ["Due on receipt", "Net 15", "Net 30", "Net 60"], { width: 200 });
    d.disclaimer("Template provided for general reference only. Confirm your invoicing meets your local tax and accounting requirements.");
  });
}

// --- 3. Residential Lease -----------------------------------------------------
async function residentialLease() {
  return build((d) => {
    d.title("Residential Lease Agreement");
    d.paragraph(
      'This Residential Lease Agreement ("Lease") is made between the Landlord and Tenant identified below, covering the property described below, subject to the terms set out here.',
    );
    d.fieldRow([
      { name: "landlord_name", label: "Landlord Name", width: 260 },
      { name: "tenant_name", label: "Tenant Name", width: 220 },
    ]);
    d.fieldRow([{ name: "property_address", label: "Property Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "lease_start", label: "Lease Start Date", width: 180 },
      { name: "lease_end", label: "Lease End Date", width: 180 },
    ]);
    d.fieldRow([
      { name: "monthly_rent", label: "Monthly Rent", width: 180 },
      { name: "security_deposit", label: "Security Deposit", width: 180 },
    ]);
    d.checkboxRow("pets_allowed", "Pets are allowed under this Lease");
    d.fieldRow([{ name: "pet_deposit", label: "Pet Deposit (if applicable)", width: 200 }]);
    d.paragraph(
      "1. Use of Premises. Tenant shall use the property solely as a private residence. 2. Rent. Rent is due in full on the first day of each month. 3. Maintenance. Tenant shall keep the property in good condition and promptly notify Landlord of needed repairs. 4. Termination. Either party may terminate this Lease as permitted by applicable local law and the notice periods it requires.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Landlord", "Tenant");
    d.disclaimer(GENERIC_DISCLAIMER + " Residential leases are heavily regulated locally — verify required disclosures and clauses for your area.");
  });
}

// --- 4. General Release -------------------------------------------------------
async function generalRelease() {
  return build((d) => {
    d.title("General Release Agreement");
    d.paragraph(
      'This General Release Agreement ("Release") is entered into by the Releasing Party and Released Party identified below, in exchange for the consideration described below, the sufficiency of which is acknowledged.',
    );
    d.fieldRow([
      { name: "releasing_party", label: "Releasing Party", width: 260 },
      { name: "released_party", label: "Released Party", width: 220 },
    ]);
    d.fieldRow([
      { name: "effective_date", label: "Effective Date", width: 180 },
      { name: "consideration", label: "Consideration (amount / description)", width: 300 },
    ]);
    d.paragraph(
      "1. Release. The Releasing Party fully and forever releases, discharges, and covenants not to sue the Released Party from any and all claims, demands, and causes of action, known or unknown, arising out of or related to the matter described below, up to the Effective Date.",
    );
    d.fieldRow([{ name: "matter_description", label: "Description of Matter Being Released", width: CONTENT_W, multiline: true }]);
    d.paragraph(
      "2. No Admission. This Release is not an admission of liability by either Party. 3. Governing Law. This Release shall be governed by the laws of the jurisdiction below.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Releasing Party", "Released Party");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 5. Contractor tax info request (explicitly NOT the IRS W-9) -------------
async function contractorTaxInfo() {
  return build((d) => {
    d.title("Contractor Tax Information Request");
    d.paragraph(
      "This is a general-purpose information-collection template and is NOT the official IRS Form W-9. For actual U.S. tax filing or information-reporting purposes, obtain the current official Form W-9 directly from irs.gov and use that form instead.",
      { size: 8.5, color: FAINT },
    );
    d.fieldRow([
      { name: "legal_name", label: "Name (as shown on your tax return)", width: 300 },
      { name: "business_name", label: "Business Name (if different)", width: 180 },
    ]);
    d.dropdownRow(
      "tax_classification",
      "Federal Tax Classification",
      ["Individual / Sole proprietor", "C Corporation", "S Corporation", "Partnership", "LLC", "Other"],
      { width: 260 },
    );
    d.fieldRow([{ name: "address", label: "Address (number, street, apt/suite)", width: CONTENT_W }]);
    d.fieldRow([
      { name: "city", label: "City", width: 180 },
      { name: "state", label: "State / Province", width: 150 },
      { name: "zip", label: "ZIP / Postal Code", width: 130 },
    ]);
    d.radioRow("tin_type", "Taxpayer Identification Number Type", ["SSN", "EIN"]);
    d.fieldRow([{ name: "tin", label: "Taxpayer Identification Number", width: 220 }]);
    d.spacer(4);
    d.paragraph("Certification: By signing below, you certify that the information provided above is correct to the best of your knowledge.");
    d.fieldRow([
      { name: "signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(
      "Unofficial template for internal record-keeping only. Not affiliated with or endorsed by the IRS. For official tax forms, visit irs.gov.",
    );
  });
}

// --- 6. General Power of Attorney -------------------------------------------
async function powerOfAttorney() {
  return build((d) => {
    d.title("General Power of Attorney");
    d.paragraph(
      'This General Power of Attorney ("Instrument") is made by the Principal identified below, appointing the Agent (also called "Attorney-in-Fact") identified below to act on the Principal\'s behalf as set out here.',
    );
    d.fieldRow([
      { name: "principal_name", label: "Principal Name", width: 260 },
      { name: "agent_name", label: "Agent / Attorney-in-Fact Name", width: 220 },
    ]);
    d.fieldRow([{ name: "principal_address", label: "Principal Address", width: CONTENT_W }]);
    d.paragraph(
      "1. Grant of Authority. The Principal grants the Agent full power and authority to act on the Principal's behalf in the areas checked below, to the same extent the Principal could act personally.",
    );
    d.checkboxRow("scope_financial", "Financial and banking transactions");
    d.checkboxRow("scope_property", "Real estate and property transactions");
    d.checkboxRow("scope_business", "Business operating decisions");
    d.checkboxRow("scope_legal", "Legal claims and litigation matters");
    d.checkboxRow("scope_other", "Other (describe below)");
    d.fieldRow([{ name: "scope_other_description", label: "Other Authority Granted (if applicable)", width: CONTENT_W }]);
    d.paragraph(
      "2. Effective Date and Duration. This Instrument is effective as of the date below and continues until revoked in writing by the Principal, or until the Principal's death, unless it states elsewhere that it survives incapacity (a \"durable\" power of attorney, which typically requires specific statutory language and witnessing/notarization in most jurisdictions).",
    );
    d.fieldRow([{ name: "effective_date", label: "Effective Date", width: 200 }]);
    d.checkboxRow("is_durable", "This power of attorney is intended to be durable (survives Principal's incapacity)");
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.fieldRow([
      { name: "principal_signature", label: "Principal — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
      { name: "agent_signature", label: "Agent — Signature (type full name, acknowledging appointment)", width: (CONTENT_W - 24) / 2 },
    ]);
    d.fieldRow([
      { name: "principal_date", label: "Date", width: (CONTENT_W - 24) / 2 },
      { name: "agent_date", label: "Date", width: (CONTENT_W - 24) / 2 },
    ]);
    d.disclaimer(
      "Power of attorney requirements (witnessing, notarization, specific statutory language for durability) vary significantly by jurisdiction and this template does not include any of that formality. This is not legal advice — have a qualified attorney prepare or review this document before signing or relying on it.",
    );
  });
}

// --- 7. Last Will and Testament (simple) ------------------------------------
async function lastWillTestament() {
  return build((d) => {
    d.title("Last Will and Testament");
    d.paragraph(
      "I, the Testator identified below, being of sound mind, declare this to be my Last Will and Testament, revoking all prior wills and codicils I have previously made.",
      { size: 8.5, color: FAINT },
    );
    d.fieldRow([
      { name: "testator_name", label: "Testator (Full Legal Name)", width: 270 },
      { name: "testator_address", label: "Address", width: 200 },
    ]);
    d.paragraph("1. Executor. I appoint the person below to serve as Executor of my estate, to act without bond if permitted by law.");
    d.fieldRow([
      { name: "executor_name", label: "Executor Name", width: 260 },
      { name: "alternate_executor_name", label: "Alternate Executor (if unable/unwilling to serve)", width: 220 },
    ]);
    d.paragraph("2. Beneficiaries and Distribution. My estate shall be distributed as follows:");
    d.fieldRow([{ name: "distribution", label: "Distribution of Assets", width: CONTENT_W, multiline: true }]);
    d.paragraph("3. Guardian for Minor Children (if applicable).");
    d.fieldRow([{ name: "guardian_name", label: "Nominated Guardian", width: 300 }]);
    d.paragraph(
      "4. Witnesses. Most jurisdictions require a will to be signed in the presence of two witnesses (who are not beneficiaries), who then also sign — some jurisdictions additionally require or allow notarization for a \"self-proving\" affidavit.",
      { size: 8.5, color: FAINT },
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.fieldRow([{ name: "testator_signature", label: "Testator — Signature (type full name)", width: 300 }]);
    d.fieldRow([
      { name: "witness_1_signature", label: "Witness 1 — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
      { name: "witness_2_signature", label: "Witness 2 — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
    ]);
    d.fieldRow([{ name: "date", label: "Date", width: 200 }]);
    d.disclaimer(
      "Wills are one of the most formality-sensitive documents in law — signing/witnessing/notarization requirements, what can and can't be left outside probate, and validity rules vary sharply by jurisdiction. A will that doesn't meet your jurisdiction's exact execution requirements can be ruled invalid. This template is a starting-point reference only — have a qualified estate-planning attorney prepare or review your actual will.",
    );
  });
}

// --- 8. Bill of Sale ---------------------------------------------------------
async function billOfSale() {
  return build((d) => {
    d.title("Bill of Sale");
    d.paragraph(
      'This Bill of Sale documents the transfer of the item(s) described below from the Seller to the Buyer identified here, in exchange for the payment described below.',
    );
    d.fieldRow([
      { name: "seller_name", label: "Seller Name", width: 260 },
      { name: "buyer_name", label: "Buyer Name", width: 220 },
    ]);
    d.fieldRow([
      { name: "sale_date", label: "Date of Sale", width: 180 },
      { name: "purchase_price", label: "Purchase Price", width: 180 },
    ]);
    d.fieldRow([{ name: "item_description", label: "Description of Item(s) Sold (include serial/VIN number if applicable)", width: CONTENT_W, multiline: true }]);
    d.paragraph(
      "1. Condition. The item(s) are sold \"as is, where is,\" with no warranties of any kind, express or implied, unless stated otherwise below. 2. Title. Seller represents that they hold clear title to the item(s) and have the right to sell them.",
    );
    d.checkboxRow("sold_as_is", "Sold as-is, with no warranty");
    d.fieldRow([{ name: "warranty_terms", label: "Warranty Terms (if any, otherwise leave blank)", width: CONTENT_W }]);
    d.spacer(6);
    d.signatureBlock("Seller", "Buyer");
    d.disclaimer(
      "For vehicles, vessels, and other titled property, most jurisdictions require a specific official bill-of-sale form and separate title transfer with the relevant motor vehicle or licensing authority — this general template may not satisfy those requirements on its own.",
    );
  });
}

// --- 9. Promissory Note ------------------------------------------------------
async function promissoryNote() {
  return build((d) => {
    d.title("Promissory Note");
    d.paragraph(
      "For value received, the Borrower identified below promises to pay to the order of the Lender identified below the principal sum stated, together with interest as specified, according to the terms of this Note.",
    );
    d.fieldRow([
      { name: "borrower_name", label: "Borrower Name", width: 260 },
      { name: "lender_name", label: "Lender Name", width: 220 },
    ]);
    d.fieldRow([
      { name: "principal_amount", label: "Principal Amount", width: 180 },
      { name: "interest_rate", label: "Annual Interest Rate (%)", width: 180 },
    ]);
    d.fieldRow([
      { name: "issue_date", label: "Date of Note", width: 180 },
      { name: "maturity_date", label: "Maturity Date (final payment due)", width: 220 },
    ]);
    d.dropdownRow("repayment_schedule", "Repayment Schedule", ["Lump sum at maturity", "Monthly installments", "Weekly installments", "On demand"]);
    d.fieldRow([{ name: "payment_amount", label: "Payment Amount (if installments)", width: 220 }]);
    d.paragraph(
      "1. Default. If Borrower fails to make any payment when due and does not cure within any notice period required by law, the entire unpaid balance becomes due immediately at Lender's option. 2. Prepayment. Borrower may prepay all or part of this Note at any time without penalty, unless stated otherwise below.",
    );
    d.checkboxRow("prepayment_penalty", "A prepayment penalty applies (describe in additional terms)");
    d.fieldRow([{ name: "additional_terms", label: "Additional Terms", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Borrower", "Lender");
    d.disclaimer(
      "Interest rate limits (usury laws), required disclosures, and enforceability rules for promissory notes vary by jurisdiction and by whether the note is secured or unsecured. Have a qualified attorney review this document, particularly for amounts beyond a small personal loan.",
    );
  });
}

// --- 10. Non-Compete / Non-Solicitation Agreement ---------------------------
async function nonCompeteAgreement() {
  return build((d) => {
    d.title("Non-Compete & Non-Solicitation Agreement");
    d.paragraph(
      "This Agreement is entered into between the Company and the Individual identified below, in connection with the Individual's employment or engagement with the Company.",
    );
    d.fieldRow([
      { name: "company_name", label: "Company Name", width: 260 },
      { name: "individual_name", label: "Individual Name", width: 220 },
    ]);
    d.fieldRow([{ name: "effective_date", label: "Effective Date", width: 200 }]);
    d.paragraph(
      "1. Non-Competition. During the Restricted Period and within the Restricted Territory below, the Individual agrees not to engage in any business that directly competes with the Company's business as described below.",
    );
    d.fieldRow([
      { name: "restricted_period", label: "Restricted Period (e.g. 12 months after termination)", width: 270 },
      { name: "restricted_territory", label: "Restricted Territory", width: 200 },
    ]);
    d.fieldRow([{ name: "business_description", label: "Description of Company's Business", width: CONTENT_W, multiline: true }]);
    d.paragraph(
      "2. Non-Solicitation. During the Restricted Period, the Individual agrees not to solicit the Company's employees, contractors, or customers for a competing purpose. 3. Reasonableness. The parties agree the restrictions above are reasonable in scope, geography, and duration to protect the Company's legitimate business interests.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Company", "Individual");
    d.disclaimer(
      "Non-compete agreements are heavily regulated and, in a growing number of U.S. states and other jurisdictions, banned or narrowly restricted for most workers (including, as of recent FTC rulemaking activity, potentially unenforceable for most employees in the United States generally — verify current law before relying on this). Enforceability turns entirely on jurisdiction-specific law. Have a qualified employment attorney review this before use.",
    );
  });
}

// --- 11. Employment Offer Letter ---------------------------------------------
async function employmentOfferLetter() {
  return build((d) => {
    d.title("Employment Offer Letter");
    d.paragraph(
      "This letter confirms an offer of employment from the Company to the Candidate on the terms below. This offer is contingent on any conditions stated here (e.g. background check, reference check) and does not create a contract for a fixed term of employment unless explicitly stated.",
    );
    d.fieldRow([
      { name: "company_name", label: "Company Name", width: 260 },
      { name: "candidate_name", label: "Candidate Name", width: 220 },
    ]);
    d.fieldRow([
      { name: "job_title", label: "Job Title", width: 260 },
      { name: "start_date", label: "Proposed Start Date", width: 220 },
    ]);
    d.dropdownRow("employment_type", "Employment Type", ["Full-time", "Part-time", "Contract", "Temporary"]);
    d.fieldRow([
      { name: "compensation", label: "Compensation (salary/rate)", width: 220 },
      { name: "pay_frequency", label: "Pay Frequency", width: 200 },
    ]);
    d.fieldRow([{ name: "benefits_summary", label: "Benefits Summary", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("at_will", "This is an at-will employment relationship (where permitted by applicable law)");
    d.fieldRow([{ name: "contingencies", label: "Contingencies (e.g. background check, right to work)", width: CONTENT_W }]);
    d.paragraph("Please indicate acceptance of this offer by signing and dating below.");
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Company", "Candidate");
    d.disclaimer(
      "Employment terms, required disclosures, and \"at-will\" enforceability vary by jurisdiction (some require specific language or don't recognize at-will employment at all). This is a general template, not a substitute for review by qualified employment counsel or HR guidance specific to your location.",
    );
  });
}

// --- 12. Master Service Agreement --------------------------------------------
async function masterServiceAgreement() {
  return build((d) => {
    d.title("Master Service Agreement");
    d.paragraph(
      'This Master Service Agreement ("Agreement") is entered into between the Client and Service Provider identified below, and governs any Statement of Work or order that references it.',
    );
    d.fieldRow([
      { name: "client_name", label: "Client (Full Legal Name)", width: 260 },
      { name: "provider_name", label: "Service Provider (Full Legal Name)", width: 220 },
    ]);
    d.fieldRow([{ name: "effective_date", label: "Effective Date", width: 200 }]);
    d.paragraph(
      "1. Services. Service Provider will perform the services described in each Statement of Work (\"SOW\") signed by both parties and incorporated by reference into this Agreement. 2. Fees. Client will pay the fees set out in each SOW according to the payment terms stated there.",
    );
    d.fieldRow([
      { name: "payment_terms", label: "Default Payment Terms", width: 220 },
      { name: "invoice_frequency", label: "Invoice Frequency", width: 220 },
    ]);
    d.paragraph(
      "3. Independent Contractor. Service Provider is an independent contractor, not an employee or agent of Client. 4. Confidentiality. Each party will protect the other's confidential information with the same care it uses for its own, and at least reasonable care. 5. Intellectual Property. Unless an SOW states otherwise, work product created specifically for Client under an SOW is owned by Client upon full payment; Service Provider retains all pre-existing tools, methods, and materials.",
    );
    d.dropdownRow("termination_notice", "Termination Notice Period", ["15 days", "30 days", "60 days", "90 days"], { width: 200 });
    d.fieldRow([{ name: "liability_cap", label: "Liability Cap (e.g. fees paid in prior 12 months)", width: 300 }]);
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Client", "Service Provider");
    d.disclaimer(GENERIC_DISCLAIMER + " Liability caps, IP assignment, and indemnification terms should be reviewed by counsel before use, especially for higher-value engagements.");
  });
}

// --- 13. Liability Waiver and Release of Claims ------------------------------
async function liabilityWaiver() {
  return build((d) => {
    d.title("Liability Waiver and Release of Claims");
    d.paragraph(
      "In consideration for being permitted to participate in the Activity described below, the Participant identified below agrees to the terms of this waiver.",
    );
    d.fieldRow([
      { name: "participant_name", label: "Participant Name", width: 260 },
      { name: "date_of_activity", label: "Date of Activity", width: 220 },
    ]);
    d.fieldRow([{ name: "activity_description", label: "Description of Activity", width: CONTENT_W }]);
    d.fieldRow([{ name: "organizer_name", label: "Organizer / Host Name", width: CONTENT_W }]);
    d.paragraph(
      "1. Assumption of Risk. Participant understands the Activity carries inherent risks, including risk of injury, and voluntarily assumes all such risks. 2. Release. Participant releases the Organizer, its employees, and agents from any and all claims, liabilities, and causes of action arising from participation in the Activity, except to the extent caused by gross negligence or intentional misconduct where such a release is not permitted by law.",
    );
    d.checkboxRow("minor_participant", "Participant is a minor (a parent/legal guardian must also sign below)");
    d.fieldRow([{ name: "emergency_contact", label: "Emergency Contact Name & Phone", width: CONTENT_W }]);
    d.spacer(6);
    d.fieldRow([
      { name: "participant_signature", label: "Participant — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
      { name: "guardian_signature", label: "Parent/Guardian — Signature (if applicable)", width: (CONTENT_W - 24) / 2 },
    ]);
    d.fieldRow([{ name: "date", label: "Date", width: 200 }]);
    d.disclaimer(
      "Waiver enforceability (especially for minors, and for gross negligence or willful misconduct) varies sharply by jurisdiction — some jurisdictions void waivers signed on a minor's behalf. Have this reviewed by qualified counsel before relying on it for any activity with real injury risk.",
    );
  });
}

// --- 14. Billing Statement ----------------------------------------------------
async function billingStatement() {
  return build((d) => {
    d.title("Billing Statement");
    d.fieldRow([
      { name: "statement_number", label: "Statement #", width: 140 },
      { name: "statement_date", label: "Statement Date", width: 140 },
      { name: "billing_period", label: "Billing Period", width: 200 },
    ]);
    d.heading("Account");
    d.fieldRow([
      { name: "account_name", label: "Account Name", width: 300 },
      { name: "account_number", label: "Account Number", width: 200 },
    ]);
    d.heading("Charges");
    const colWidths = [220, 90, 90, 60];
    const colLabels = ["Description", "Date", "Amount", "Ref."];
    for (let row = 1; row <= 6; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `charge_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 18 },
      );
    }
    d.fieldRow([
      { name: "previous_balance", label: "Previous Balance", width: 113 },
      { name: "payments_received", label: "Payments Received", width: 113 },
      { name: "current_charges", label: "Current Charges", width: 113 },
      { name: "balance_due", label: "Balance Due", width: 113 },
    ]);
    d.fieldRow([{ name: "payment_due_date", label: "Payment Due Date", width: 200 }]);
    d.disclaimer("Template provided for general reference only. Confirm this meets your local billing-disclosure and accounting requirements.");
  });
}

// --- 15. Purchase Order --------------------------------------------------------
async function purchaseOrder() {
  return build((d) => {
    d.title("Purchase Order");
    d.fieldRow([
      { name: "po_number", label: "PO Number", width: 140 },
      { name: "po_date", label: "Date", width: 140 },
      { name: "requested_delivery", label: "Requested Delivery Date", width: 180 },
    ]);
    d.heading("Buyer");
    d.fieldRow([{ name: "buyer_company", label: "Company Name", width: CONTENT_W }]);
    d.fieldRow([{ name: "buyer_address", label: "Billing / Shipping Address", width: CONTENT_W }]);
    d.heading("Vendor");
    d.fieldRow([{ name: "vendor_company", label: "Company Name", width: CONTENT_W }]);
    d.fieldRow([{ name: "vendor_contact", label: "Contact Name / Email", width: CONTENT_W }]);
    d.heading("Items Ordered");
    const colWidths = [220, 60, 90, 90];
    const colLabels = ["Description", "Qty", "Unit Price", "Amount"];
    for (let row = 1; row <= 6; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `item_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 18 },
      );
    }
    d.fieldRow([
      { name: "total_amount", label: "Total Order Amount", width: 200 },
      { name: "shipping_terms", label: "Shipping Terms", width: 240 },
    ]);
    d.spacer(6);
    d.signatureBlock("Authorized Buyer", "Vendor Acknowledgment");
    d.disclaimer("Template provided for general reference only. Confirm this meets your organization's procurement approval and accounting requirements.");
  });
}

// --- 16. Commercial Lease Agreement --------------------------------------------
async function commercialLease() {
  return build((d) => {
    d.title("Commercial Lease Agreement");
    d.paragraph(
      'This Commercial Lease Agreement ("Lease") is made between the Landlord and Tenant identified below, covering the commercial premises described below.',
    );
    d.fieldRow([
      { name: "landlord_name", label: "Landlord Name", width: 260 },
      { name: "tenant_name", label: "Tenant / Business Name", width: 220 },
    ]);
    d.fieldRow([{ name: "premises_address", label: "Premises Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "permitted_use", label: "Permitted Use of Premises", width: 300 },
      { name: "square_footage", label: "Approx. Square Footage", width: 180 },
    ]);
    d.fieldRow([
      { name: "lease_start", label: "Lease Start Date", width: 180 },
      { name: "lease_end", label: "Lease End Date", width: 180 },
    ]);
    d.dropdownRow("lease_type", "Lease Type", ["Gross lease", "Modified gross", "Triple net (NNN)", "Percentage lease"], { width: 220 });
    d.fieldRow([
      { name: "base_rent", label: "Base Monthly Rent", width: 180 },
      { name: "security_deposit", label: "Security Deposit", width: 180 },
    ]);
    d.paragraph(
      "1. Operating Costs. For a triple net or modified gross lease, Tenant additionally pays its proportionate share of property taxes, insurance, and common area maintenance as described in an attached schedule. 2. Maintenance. Landlord maintains structural elements and common areas; Tenant maintains the interior of the leased premises. 3. Assignment. Tenant may not assign this Lease or sublet the premises without Landlord's prior written consent.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Landlord", "Tenant");
    d.disclaimer(GENERIC_DISCLAIMER + " Commercial lease terms (CAM charges, zoning, ADA compliance) are commonly negotiated with counsel — have this reviewed before signing.");
  });
}

// --- 17. Property Condition Disclosure Statement -------------------------------
async function propertyDisclosure() {
  return build((d) => {
    d.title("Property Condition Disclosure Statement");
    d.paragraph(
      "The Seller identified below discloses the following information about the condition of the property described below, to the best of Seller's knowledge as of the date signed.",
    );
    d.fieldRow([
      { name: "seller_name", label: "Seller Name", width: 240 },
      { name: "property_address", label: "Property Address", width: 240 },
    ]);
    d.heading("Systems and Structure");
    for (const [name, label] of [
      ["roof", "Roof — any known leaks or repairs in the last 5 years?"],
      ["foundation", "Foundation — any known cracking, settling, or water intrusion?"],
      ["electrical", "Electrical system — any known issues or non-permitted work?"],
      ["plumbing", "Plumbing system — any known leaks, or history of frozen/burst pipes?"],
      ["hvac", "Heating/cooling system — age and any known issues?"],
      ["pests", "Any known history of termite, pest, or wood-destroying organism damage?"],
      ["hazards", "Any known presence of asbestos, lead paint, mold, or radon?"],
    ]) {
      d.fieldRow([{ name, label, width: CONTENT_W }]);
    }
    d.checkboxRow("flood_zone", "Property is located in a designated flood zone (to Seller's knowledge)");
    d.fieldRow([{ name: "additional_disclosures", label: "Additional Disclosures", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([
      { name: "seller_signature", label: "Seller — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
      { name: "buyer_acknowledgment", label: "Buyer — Acknowledgment of Receipt (type full name)", width: (CONTENT_W - 24) / 2 },
    ]);
    d.fieldRow([{ name: "date", label: "Date", width: 200 }]);
    d.disclaimer(
      "Most jurisdictions have a specific mandatory disclosure form and required disclosure items (this general template may not include all of them) — use your jurisdiction's official disclosure form where one is required, and have a real estate attorney or licensed agent confirm compliance.",
    );
  });
}

// --- 18. Job Application Form --------------------------------------------------
async function jobApplicationForm() {
  return build((d) => {
    d.title("Employment Application");
    d.fieldRow([
      { name: "applicant_name", label: "Full Name", width: 260 },
      { name: "position_applied", label: "Position Applied For", width: 220 },
    ]);
    d.fieldRow([
      { name: "phone", label: "Phone", width: 140 },
      { name: "email", label: "Email", width: 180 },
      { name: "available_start_date", label: "Available Start Date", width: 130 },
    ]);
    d.fieldRow([{ name: "address", label: "Address", width: CONTENT_W }]);
    d.dropdownRow("employment_type_desired", "Employment Type Desired", ["Full-time", "Part-time", "Contract", "Either"], { width: 220 });
    d.heading("Work Experience");
    for (let i = 1; i <= 2; i++) {
      d.fieldRow([
        { name: `employer_${i}`, label: `Employer ${i}`, width: 180 },
        { name: `title_${i}`, label: "Job Title", width: 150 },
        { name: `dates_${i}`, label: "Dates Employed", width: 130 },
      ]);
      d.fieldRow([{ name: `duties_${i}`, label: "Responsibilities / Reason for Leaving", width: CONTENT_W }]);
    }
    d.heading("Education");
    d.fieldRow([
      { name: "school_name", label: "School / Institution", width: 270 },
      { name: "degree", label: "Degree / Field of Study", width: 200 },
    ]);
    d.checkboxRow("eligible_to_work", "I am legally eligible to work in this country");
    d.checkboxRow("requires_sponsorship", "I will require visa sponsorship now or in the future");
    d.paragraph("I certify that the information provided in this application is true and complete to the best of my knowledge.");
    d.fieldRow([
      { name: "applicant_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER + " Application questions permitted by law vary by jurisdiction — confirm this form doesn't ask anything prohibited where you're hiring.");
  });
}

// --- 19. Performance Evaluation Form --------------------------------------------
async function performanceEvaluation() {
  return build((d) => {
    d.title("Employee Performance Evaluation");
    d.fieldRow([
      { name: "employee_name", label: "Employee Name", width: 260 },
      { name: "job_title", label: "Job Title", width: 220 },
    ]);
    d.fieldRow([
      { name: "review_period", label: "Review Period", width: 220 },
      { name: "reviewer_name", label: "Reviewer Name", width: 220 },
    ]);
    d.heading("Ratings (1 = Needs Improvement, 5 = Outstanding)");
    for (const [name, label] of [
      ["quality_of_work", "Quality of Work"],
      ["productivity", "Productivity"],
      ["communication", "Communication"],
      ["teamwork", "Teamwork & Collaboration"],
      ["initiative", "Initiative & Problem-Solving"],
      ["reliability", "Reliability & Attendance"],
    ]) {
      d.dropdownRow(name, label, ["1", "2", "3", "4", "5"], { width: 120 });
    }
    d.fieldRow([{ name: "strengths", label: "Key Strengths", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "areas_for_improvement", label: "Areas for Improvement", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "goals_next_period", label: "Goals for Next Review Period", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("employee_acknowledges", "Employee acknowledges this review was discussed with them (signature below does not necessarily indicate agreement)");
    d.spacer(6);
    d.signatureBlock("Employee", "Reviewer");
    d.disclaimer("Template provided for general reference only. Align rating scales and categories with your organization's own performance-management policy.");
  });
}

// --- 20. Patient Intake Form ----------------------------------------------------
async function patientIntakeForm() {
  return build((d) => {
    d.title("Patient Intake Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 230 },
      { name: "date_of_birth", label: "Date of Birth", width: 150 },
      { name: "sex", label: "Sex", width: 90 },
    ]);
    d.fieldRow([
      { name: "phone", label: "Phone", width: 180 },
      { name: "email", label: "Email", width: 220 },
    ]);
    d.fieldRow([{ name: "address", label: "Address", width: CONTENT_W }]);
    d.heading("Insurance");
    d.fieldRow([
      { name: "insurance_provider", label: "Insurance Provider", width: 260 },
      { name: "policy_number", label: "Policy / Member Number", width: 220 },
    ]);
    d.heading("Medical History");
    d.fieldRow([{ name: "current_medications", label: "Current Medications", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "allergies", label: "Known Allergies", width: CONTENT_W }]);
    d.fieldRow([{ name: "past_conditions", label: "Past or Current Medical Conditions", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "reason_for_visit", label: "Reason for Today's Visit", width: CONTENT_W }]);
    d.heading("Emergency Contact");
    d.fieldRow([
      { name: "emergency_contact_name", label: "Name", width: 260 },
      { name: "emergency_contact_phone", label: "Phone", width: 200 },
    ]);
    d.paragraph("I certify the information above is accurate to the best of my knowledge.");
    d.fieldRow([
      { name: "patient_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(
      "This intake form is a general template and does not by itself satisfy HIPAA or other health-privacy regulatory requirements — pair it with your practice's own privacy-practices notice and consent forms, and confirm required fields for your specialty and jurisdiction.",
    );
  });
}

// --- 21. HIPAA Privacy Practices Acknowledgment ---------------------------------
async function hipaaAcknowledgment() {
  return build((d) => {
    d.title("Acknowledgment of Receipt of Notice of Privacy Practices");
    d.paragraph(
      "I acknowledge that I have been offered and/or have received a copy of this practice's Notice of Privacy Practices, describing how my health information may be used and disclosed and how I can access that information.",
      { size: 8.5, color: FAINT },
    );
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 300 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "practice_name", label: "Practice / Provider Name", width: CONTENT_W }]);
    d.checkboxRow("received_notice", "I received a copy of the Notice of Privacy Practices");
    d.checkboxRow("declined_signature", "Patient was offered the Notice but declined to sign this acknowledgment (staff: describe circumstances below)");
    d.fieldRow([{ name: "decline_circumstances", label: "Circumstances (if declined)", width: CONTENT_W }]);
    d.heading("Authorized Communication (optional)");
    d.fieldRow([{ name: "authorized_contacts", label: "Individuals authorized to receive information on my behalf", width: CONTENT_W }]);
    d.spacer(6);
    d.fieldRow([
      { name: "patient_signature", label: "Patient / Representative — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
      { name: "relationship", label: "Relationship to Patient (if not patient)", width: (CONTENT_W - 24) / 2 },
    ]);
    d.fieldRow([{ name: "date", label: "Date", width: 200 }]);
    d.disclaimer(
      "This is a general-reference acknowledgment template, not legal advice. Actual HIPAA compliance depends on your practice's full Notice of Privacy Practices, workforce training, and safeguards — consult a compliance professional.",
    );
  });
}

// --- 22. Bill of Lading -----------------------------------------------------------
async function billOfLading() {
  return build((d) => {
    d.title("Bill of Lading");
    d.fieldRow([
      { name: "bol_number", label: "B/L Number", width: 160 },
      { name: "ship_date", label: "Ship Date", width: 160 },
    ]);
    d.heading("Shipper");
    d.fieldRow([{ name: "shipper_name", label: "Name / Company", width: CONTENT_W }]);
    d.fieldRow([{ name: "shipper_address", label: "Address", width: CONTENT_W }]);
    d.heading("Consignee");
    d.fieldRow([{ name: "consignee_name", label: "Name / Company", width: CONTENT_W }]);
    d.fieldRow([{ name: "consignee_address", label: "Address", width: CONTENT_W }]);
    d.heading("Carrier");
    d.fieldRow([
      { name: "carrier_name", label: "Carrier Name", width: 260 },
      { name: "vehicle_trailer_number", label: "Vehicle / Trailer Number", width: 220 },
    ]);
    d.heading("Freight Description");
    const colWidths = [70, 200, 80, 80];
    const colLabels = ["Qty", "Description of Goods", "Weight", "Class"];
    for (let row = 1; row <= 5; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `item_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 18 },
      );
    }
    d.checkboxRow("hazmat", "Shipment contains hazardous materials (attach required hazmat documentation)");
    d.paragraph("Received, subject to individually determined rates or contracts that have been agreed upon between carrier and shipper.");
    d.spacer(6);
    d.signatureBlock("Shipper", "Carrier");
    d.disclaimer(
      "This is a general-reference template, not a substitute for a carrier's own required Bill of Lading format or for hazmat/DOT/international-shipping-specific documentation where applicable.",
    );
  });
}

// --- 23. Packing Slip --------------------------------------------------------------
async function packingSlip() {
  return build((d) => {
    d.title("Packing Slip");
    d.fieldRow([
      { name: "order_number", label: "Order #", width: 160 },
      { name: "ship_date", label: "Ship Date", width: 160 },
      { name: "package_number", label: "Package # (e.g. 1 of 2)", width: 160 },
    ]);
    d.heading("Ship From");
    d.fieldRow([{ name: "ship_from", label: "Name / Address", width: CONTENT_W, multiline: true }]);
    d.heading("Ship To");
    d.fieldRow([{ name: "ship_to", label: "Name / Address", width: CONTENT_W, multiline: true }]);
    d.heading("Items in This Package");
    const colWidths = [80, 200, 80, 70];
    const colLabels = ["SKU", "Description", "Qty Ordered", "Qty Shipped"];
    for (let row = 1; row <= 7; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `item_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 16 },
      );
    }
    d.fieldRow([{ name: "special_instructions", label: "Special Handling Instructions", width: CONTENT_W }]);
    d.disclaimer("Template provided for general reference only.");
  });
}

// --- 24. Work Order Sign-Off --------------------------------------------------------
async function workOrderSignOff() {
  return build((d) => {
    d.title("Work Order Completion Sign-Off");
    d.fieldRow([
      { name: "work_order_number", label: "Work Order #", width: 160 },
      { name: "date_completed", label: "Date Completed", width: 160 },
    ]);
    d.fieldRow([{ name: "site_location", label: "Site / Location", width: CONTENT_W }]);
    d.fieldRow([{ name: "work_description", label: "Description of Work Performed", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "technician_name", label: "Technician / Crew Name", width: 260 },
      { name: "hours_worked", label: "Hours Worked", width: 160 },
    ]);
    d.heading("Materials Used");
    d.fieldRow([{ name: "materials_used", label: "Materials / Parts Used", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("area_cleaned", "Work area was cleaned and restored");
    d.checkboxRow("client_walkthrough", "Client walkthrough completed");
    d.fieldRow([{ name: "follow_up_needed", label: "Follow-Up Work Needed (if any)", width: CONTENT_W }]);
    d.paragraph("By signing below, the Client confirms the work described above was completed satisfactorily.");
    d.spacer(6);
    d.signatureBlock("Technician", "Client");
    d.disclaimer("Template provided for general reference only.");
  });
}

// --- 25. Safety Incident Report -----------------------------------------------------
async function safetyIncidentReport() {
  return build((d) => {
    d.title("Safety Incident Report");
    d.fieldRow([
      { name: "incident_date", label: "Date of Incident", width: 140 },
      { name: "incident_time", label: "Time", width: 110 },
      { name: "location", label: "Location", width: 220 },
    ]);
    d.fieldRow([
      { name: "reported_by", label: "Reported By", width: 240 },
      { name: "person_involved", label: "Person(s) Involved", width: 240 },
    ]);
    d.dropdownRow("incident_type", "Incident Type", ["Injury", "Near miss", "Property damage", "Equipment failure", "Other"], { width: 220 });
    d.fieldRow([{ name: "incident_description", label: "Description of Incident", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "injuries_sustained", label: "Injuries Sustained (if any)", width: CONTENT_W }]);
    d.checkboxRow("medical_attention", "Medical attention was required");
    d.checkboxRow("authorities_notified", "Relevant authorities/regulator notified");
    d.fieldRow([{ name: "immediate_action_taken", label: "Immediate Action Taken", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "corrective_action", label: "Recommended Corrective Action", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "witnesses", label: "Witnesses (names)", width: CONTENT_W }]);
    d.spacer(6);
    d.signatureBlock("Reported By", "Supervisor Review");
    d.disclaimer(
      "Regulatory incident-reporting requirements (timelines, mandatory notification, specific agency forms — e.g. OSHA in the U.S.) vary by jurisdiction and industry. Use your organization's official incident-reporting process alongside this template.",
    );
  });
}

// --- 26. Board Meeting Minutes -------------------------------------------------------
async function boardMeetingMinutes() {
  return build((d) => {
    d.title("Board of Directors — Meeting Minutes");
    d.fieldRow([
      { name: "company_name", label: "Company Name", width: 300 },
      { name: "meeting_date", label: "Meeting Date", width: 200 },
    ]);
    d.fieldRow([
      { name: "meeting_location", label: "Location / Method (e.g. video conference)", width: 300 },
      { name: "meeting_time", label: "Time Called to Order", width: 200 },
    ]);
    d.fieldRow([{ name: "directors_present", label: "Directors Present", width: CONTENT_W }]);
    d.fieldRow([{ name: "directors_absent", label: "Directors Absent", width: CONTENT_W }]);
    d.checkboxRow("quorum_confirmed", "Quorum was confirmed present");
    d.heading("Agenda Items and Discussion");
    d.fieldRow([{ name: "agenda_discussion", label: "Summary of Discussion", width: CONTENT_W, multiline: true }]);
    d.heading("Resolutions");
    d.fieldRow([{ name: "resolutions", label: "Resolutions Adopted (include vote counts)", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "adjournment_time", label: "Time Adjourned", width: 200 }]);
    d.spacer(6);
    d.fieldRow([{ name: "secretary_signature", label: "Recorded By / Secretary — Signature (type full name)", width: 300 }]);
    d.fieldRow([{ name: "date", label: "Date", width: 200 }]);
    d.disclaimer("Template provided for general reference only. Confirm this satisfies your company's bylaws and applicable corporate record-keeping requirements.");
  });
}

// --- 27. Stock Purchase Agreement (simple) ---------------------------------------------
async function stockPurchaseAgreement() {
  return build((d) => {
    d.title("Stock Purchase Agreement");
    d.paragraph(
      'This Stock Purchase Agreement ("Agreement") is entered into between the Seller and Buyer identified below, for the purchase and sale of shares in the Company described below.',
    );
    d.fieldRow([
      { name: "company_name", label: "Company Name", width: 260 },
      { name: "share_class", label: "Class of Shares", width: 220 },
    ]);
    d.fieldRow([
      { name: "seller_name", label: "Seller Name", width: 260 },
      { name: "buyer_name", label: "Buyer Name", width: 220 },
    ]);
    d.fieldRow([
      { name: "number_of_shares", label: "Number of Shares", width: 150 },
      { name: "price_per_share", label: "Price Per Share", width: 150 },
      { name: "total_purchase_price", label: "Total Purchase Price", width: 150 },
    ]);
    d.fieldRow([{ name: "closing_date", label: "Closing Date", width: 200 }]);
    d.paragraph(
      "1. Representations. Seller represents that it holds good and marketable title to the shares, free of liens except as disclosed. 2. Conditions to Closing. Closing is subject to any required corporate approvals, rights of first refusal, or transfer restrictions under the Company's governing documents. 3. Further Assurances. Each party will execute any further documents reasonably necessary to complete the transfer.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Seller", "Buyer");
    d.disclaimer(
      GENERIC_DISCLAIMER + " Securities transfers commonly implicate transfer restrictions, rights of first refusal, and securities-law considerations — have this reviewed by qualified counsel before closing.",
    );
  });
}

// --- 28. Insurance Claim Intake Form ------------------------------------------------
async function insuranceClaimIntake() {
  return build((d) => {
    d.title("Insurance Claim Intake Form");
    d.fieldRow([
      { name: "policy_number", label: "Policy Number", width: 220 },
      { name: "claim_number", label: "Claim Number (if assigned)", width: 220 },
    ]);
    d.fieldRow([
      { name: "policyholder_name", label: "Policyholder Name", width: 300 },
      { name: "date_of_loss", label: "Date of Loss", width: 180 },
    ]);
    d.fieldRow([{ name: "loss_location", label: "Location of Loss", width: CONTENT_W }]);
    d.dropdownRow("claim_type", "Type of Claim", ["Property damage", "Auto", "Liability", "Theft", "Other"], { width: 220 });
    d.fieldRow([{ name: "loss_description", label: "Description of What Happened", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "estimated_loss_amount", label: "Estimated Loss Amount", width: 220 }]);
    d.checkboxRow("police_report_filed", "A police report was filed (attach a copy if available)");
    d.fieldRow([{ name: "police_report_number", label: "Police Report Number (if applicable)", width: 260 }]);
    d.fieldRow([{ name: "witnesses", label: "Witnesses (names and contact info)", width: CONTENT_W }]);
    d.paragraph("I certify the information provided above is true and complete to the best of my knowledge.");
    d.fieldRow([
      { name: "claimant_signature", label: "Claimant — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer("Template provided for general reference only. Follow your insurer's official claim-filing process and required forms alongside this intake.");
  });
}

// --- 29. Proof of Loss Statement ----------------------------------------------------
async function proofOfLoss() {
  return build((d) => {
    d.title("Proof of Loss Statement");
    d.fieldRow([
      { name: "policy_number", label: "Policy Number", width: 220 },
      { name: "claim_number", label: "Claim Number", width: 220 },
    ]);
    d.fieldRow([
      { name: "insured_name", label: "Insured Name", width: 300 },
      { name: "date_of_loss", label: "Date of Loss", width: 180 },
    ]);
    d.fieldRow([{ name: "property_address", label: "Property / Location Affected", width: CONTENT_W }]);
    d.heading("Itemized Loss");
    const colWidths = [280, 90, 90];
    const colLabels = ["Item Description", "Value", "Amount Claimed"];
    for (let row = 1; row <= 8; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `item_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 16 },
      );
    }
    d.fieldRow([{ name: "total_claimed", label: "Total Amount Claimed", width: 220 }]);
    d.paragraph(
      "I swear/affirm that the foregoing statement is a true and accurate account of the loss described, and that no material facts have been concealed or misrepresented.",
    );
    d.fieldRow([
      { name: "insured_signature", label: "Insured — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(
      "Many policies require a Proof of Loss on the insurer's own specific form and within a strict deadline — confirm your policy's exact requirements rather than relying on this general template alone. Misrepresenting a claim can void coverage and may constitute insurance fraud.",
    );
  });
}

// --- 30. Vendor Registration Form -----------------------------------------------------
async function vendorRegistrationForm() {
  return build((d) => {
    d.title("Vendor Registration Form");
    d.fieldRow([
      { name: "company_name", label: "Company / Vendor Name", width: 270 },
      { name: "dba_name", label: "DBA (if different)", width: 200 },
    ]);
    d.fieldRow([{ name: "business_address", label: "Business Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "contact_name", label: "Primary Contact Name", width: 260 },
      { name: "contact_email", label: "Contact Email", width: 220 },
    ]);
    d.dropdownRow("business_type", "Business Type", ["Sole proprietor", "LLC", "Corporation", "Partnership", "Other"], { width: 220 });
    d.fieldRow([
      { name: "tax_id", label: "Tax ID / EIN", width: 220 },
      { name: "years_in_business", label: "Years in Business", width: 160 },
    ]);
    d.fieldRow([{ name: "products_services", label: "Products / Services Offered", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "references", label: "Business References (name / company / phone)", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("insurance_on_file", "Certificate of insurance is on file or attached");
    d.paragraph("I certify the information provided above is accurate and complete.");
    d.fieldRow([
      { name: "authorized_signature", label: "Authorized Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer("Template provided for general reference only. Align required fields with your organization's own vendor-onboarding and compliance policy.");
  });
}

// --- 31. Subcontractor Agreement -----------------------------------------------------
async function subcontractorAgreement() {
  return build((d) => {
    d.title("Subcontractor Agreement");
    d.paragraph(
      'This Subcontractor Agreement ("Agreement") is entered into between the General Contractor and Subcontractor identified below, for the work described below.',
    );
    d.fieldRow([
      { name: "contractor_name", label: "General Contractor", width: 260 },
      { name: "subcontractor_name", label: "Subcontractor", width: 220 },
    ]);
    d.fieldRow([{ name: "project_name", label: "Project Name / Address", width: CONTENT_W }]);
    d.fieldRow([{ name: "scope_of_work", label: "Scope of Work", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "contract_price", label: "Contract Price", width: 200 },
      { name: "payment_schedule", label: "Payment Schedule", width: 260 },
    ]);
    d.fieldRow([
      { name: "start_date", label: "Start Date", width: 180 },
      { name: "completion_date", label: "Estimated Completion Date", width: 220 },
    ]);
    d.paragraph(
      "1. Compliance. Subcontractor will perform the work in a good and workmanlike manner, in compliance with applicable building codes and safety regulations. 2. Insurance. Subcontractor will maintain general liability and any legally required workers' compensation insurance for the duration of the work, and provide certificates of insurance on request. 3. Indemnification. Subcontractor will indemnify the General Contractor against claims arising from Subcontractor's negligent acts or omissions in performing the work.",
    );
    d.checkboxRow("licensed", "Subcontractor holds all licenses required by law for this work");
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("General Contractor", "Subcontractor");
    d.disclaimer(
      GENERIC_DISCLAIMER + " Construction contracts commonly implicate lien rights, licensing, and insurance requirements that vary by jurisdiction — have this reviewed by qualified counsel before use on any real project.",
    );
  });
}

// --- 32. Rental Application ------------------------------------------------------
async function rentalApplication() {
  return build((d) => {
    d.title("Rental Application");
    d.fieldRow([
      { name: "applicant_name", label: "Applicant Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([
      { name: "phone", label: "Phone", width: 160 },
      { name: "email", label: "Email", width: 220 },
      { name: "ssn_last4", label: "SSN (last 4)", width: 100 },
    ]);
    d.fieldRow([{ name: "current_address", label: "Current Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "current_landlord", label: "Current Landlord Name & Phone", width: 300 },
      { name: "monthly_rent_current", label: "Current Monthly Rent", width: 180 },
    ]);
    d.heading("Employment");
    d.fieldRow([
      { name: "employer_name", label: "Employer Name", width: 260 },
      { name: "job_title", label: "Job Title", width: 220 },
    ]);
    d.fieldRow([
      { name: "monthly_income", label: "Gross Monthly Income", width: 200 },
      { name: "employment_length", label: "Length of Employment", width: 200 },
    ]);
    d.heading("Household");
    d.fieldRow([
      { name: "occupants", label: "Number of Occupants", width: 160 },
      { name: "pets", label: "Pets (type/breed/weight)", width: 300 },
    ]);
    d.checkboxRow("smoker", "Applicant or occupant smokes");
    d.fieldRow([{ name: "references", label: "Personal References (name / relationship / phone)", width: CONTENT_W, multiline: true }]);
    d.paragraph("I authorize the landlord to verify the information above, including a credit and background check, as permitted by law.");
    d.fieldRow([
      { name: "applicant_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(
      "Fair housing law prohibits screening criteria based on protected characteristics — confirm your screening questions and process comply with federal, state, and local fair housing requirements.",
    );
  });
}

// --- 33. Move-In / Move-Out Inspection Checklist -----------------------------------
async function moveInMoveOutChecklist() {
  return build((d) => {
    d.title("Move-In / Move-Out Inspection Checklist");
    d.fieldRow([
      { name: "property_address", label: "Property Address", width: 300 },
      { name: "unit", label: "Unit #", width: 160 },
    ]);
    d.fieldRow([
      { name: "tenant_name", label: "Tenant Name", width: 260 },
      { name: "inspection_date", label: "Inspection Date", width: 200 },
    ]);
    d.dropdownRow("inspection_type", "Inspection Type", ["Move-in", "Move-out"], { width: 180 });
    d.heading("Room-by-Room Condition (note damage, or write \"Good\")");
    for (const room of ["Living Room", "Kitchen", "Bedroom(s)", "Bathroom(s)", "Hallways / Closets", "Windows & Doors", "Appliances", "Walls & Paint", "Floors / Carpet", "Exterior / Yard (if applicable)"]) {
      d.fieldRow([{ name: room.toLowerCase().replace(/[^a-z]+/g, "_"), label: room, width: CONTENT_W }]);
    }
    d.fieldRow([{ name: "keys_received", label: "Keys / Fobs / Remotes Received (count)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Landlord / Agent", "Tenant");
    d.disclaimer("Complete this at both move-in and move-out and compare the two — this is the primary evidence used to resolve security deposit disputes.");
  });
}

// --- 34. Tenant Ledger --------------------------------------------------------------
async function tenantLedger() {
  return build((d) => {
    d.title("Tenant Ledger");
    d.fieldRow([
      { name: "tenant_name", label: "Tenant Name", width: 260 },
      { name: "property_address", label: "Property / Unit", width: 220 },
    ]);
    d.fieldRow([
      { name: "monthly_rent", label: "Monthly Rent", width: 180 },
      { name: "lease_start", label: "Lease Start", width: 180 },
    ]);
    d.heading("Payment History");
    const colWidths = [80, 150, 90, 90];
    const colLabels = ["Date", "Description", "Charge", "Payment"];
    for (let row = 1; row <= 10; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `entry_${row}_${label.toLowerCase()}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 16 },
      );
    }
    d.fieldRow([{ name: "running_balance", label: "Current Balance", width: 200 }]);
    d.disclaimer("Template provided for general reference only. Confirm this meets your local accounting and record-retention requirements.");
  });
}

// --- 35. Maintenance Request ---------------------------------------------------------
async function maintenanceRequest() {
  return build((d) => {
    d.title("Maintenance Request");
    d.fieldRow([
      { name: "tenant_name", label: "Tenant Name", width: 240 },
      { name: "unit", label: "Unit / Property Address", width: 240 },
    ]);
    d.fieldRow([
      { name: "phone", label: "Best Contact Phone", width: 200 },
      { name: "date_submitted", label: "Date Submitted", width: 180 },
    ]);
    d.dropdownRow("urgency", "Urgency", ["Emergency (safety/no water/no heat)", "Urgent", "Routine"], { width: 300 });
    d.fieldRow([{ name: "issue_location", label: "Location of Issue (e.g. kitchen, bathroom)", width: CONTENT_W }]);
    d.fieldRow([{ name: "issue_description", label: "Description of Problem", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("permission_to_enter", "Landlord/maintenance staff may enter without tenant present");
    d.fieldRow([{ name: "preferred_times", label: "Preferred Access Times", width: CONTENT_W }]);
    d.heading("For Office Use");
    d.fieldRow([
      { name: "assigned_to", label: "Assigned To", width: 260 },
      { name: "date_completed", label: "Date Completed", width: 200 },
    ]);
    d.disclaimer("Emergency issues (gas leaks, active flooding, no heat in freezing weather) should also be reported by phone immediately, not only in writing.");
  });
}

// --- 36. Pet Addendum ------------------------------------------------------------------
async function petAddendum() {
  return build((d) => {
    d.title("Pet Addendum to Lease Agreement");
    d.paragraph("This Addendum amends the Lease Agreement between Landlord and Tenant identified below to permit the pet(s) described here.");
    d.fieldRow([
      { name: "landlord_name", label: "Landlord Name", width: 260 },
      { name: "tenant_name", label: "Tenant Name", width: 220 },
    ]);
    d.fieldRow([{ name: "property_address", label: "Property Address", width: CONTENT_W }]);
    d.heading("Pet Information");
    d.fieldRow([
      { name: "pet_type", label: "Type / Breed", width: 200 },
      { name: "pet_weight", label: "Weight", width: 120 },
      { name: "pet_name", label: "Pet Name", width: 140 },
    ]);
    d.fieldRow([{ name: "vaccination_status", label: "Vaccination / License Status", width: CONTENT_W }]);
    d.fieldRow([
      { name: "pet_deposit", label: "Pet Deposit", width: 180 },
      { name: "pet_rent", label: "Additional Monthly Pet Rent", width: 220 },
    ]);
    d.paragraph(
      "Tenant agrees to keep the pet under control at all times, clean up after the pet, and is responsible for any damage the pet causes beyond normal wear and tear. Landlord may revoke this Addendum if the pet causes damage or disturbs other residents.",
    );
    d.spacer(6);
    d.signatureBlock("Landlord", "Tenant");
    d.disclaimer(GENERIC_DISCLAIMER + " Service and support animals are generally not \"pets\" under fair housing law and may not be subject to pet fees/deposits — confirm your policy complies with applicable law.");
  });
}

// --- 37. Eviction Notice ---------------------------------------------------------------
async function evictionNotice() {
  return build((d) => {
    d.title("Notice to Vacate / Pay Rent");
    d.fieldRow([
      { name: "tenant_name", label: "Tenant Name", width: 240 },
      { name: "property_address", label: "Property Address", width: 240 },
    ]);
    d.fieldRow([{ name: "notice_date", label: "Date of This Notice", width: 200 }]);
    d.dropdownRow("notice_reason", "Reason for Notice", ["Non-payment of rent", "Lease violation", "End of tenancy (no fault)", "Other"], { width: 260 });
    d.fieldRow([{ name: "amount_owed", label: "Amount Owed (if non-payment)", width: 220 }]);
    d.fieldRow([{ name: "violation_description", label: "Description of Violation (if applicable)", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "cure_or_vacate_by", label: "Deadline to Cure / Vacate By", width: 220 }]);
    d.paragraph(
      "You are hereby notified that you must cure the above condition or vacate the premises by the date stated above, or legal proceedings may be initiated to recover possession of the property.",
    );
    d.spacer(6);
    d.fieldRow([
      { name: "landlord_signature", label: "Landlord / Agent — Signature (type full name)", width: 300 },
      { name: "date_served", label: "Date Served", width: 200 },
    ]);
    d.disclaimer(
      "Eviction notices are one of the most strictly regulated documents in landlord-tenant law: required notice periods, exact wording, and service methods vary sharply by state/locality, and getting this wrong can void the whole eviction. Do not rely on this generic template for an actual eviction — use your jurisdiction's required form and process, and consult a landlord-tenant attorney.",
    );
  });
}

// --- 38. Rent Increase Notice --------------------------------------------------------
async function rentIncreaseNotice() {
  return build((d) => {
    d.title("Notice of Rent Increase");
    d.fieldRow([
      { name: "tenant_name", label: "Tenant Name", width: 240 },
      { name: "property_address", label: "Property Address", width: 240 },
    ]);
    d.fieldRow([{ name: "notice_date", label: "Date of This Notice", width: 200 }]);
    d.fieldRow([
      { name: "current_rent", label: "Current Monthly Rent", width: 200 },
      { name: "new_rent", label: "New Monthly Rent", width: 200 },
    ]);
    d.fieldRow([{ name: "effective_date", label: "Effective Date of New Rent", width: 220 }]);
    d.paragraph("This notice is provided in accordance with the notice period required under your lease and applicable law. Please contact us with any questions.");
    d.spacer(6);
    d.fieldRow([{ name: "landlord_signature", label: "Landlord / Agent — Signature (type full name)", width: 300 }]);
    d.disclaimer(
      "Required advance-notice periods for rent increases (and whether increases are capped or restricted at all, under rent control/stabilization) vary by jurisdiction — confirm the applicable rule before sending this notice.",
    );
  });
}

// --- 39. Security Deposit Return / Itemization ---------------------------------------
async function securityDepositReturn() {
  return build((d) => {
    d.title("Security Deposit Return Statement");
    d.fieldRow([
      { name: "tenant_name", label: "Tenant Name", width: 240 },
      { name: "property_address", label: "Property Address", width: 240 },
    ]);
    d.fieldRow([
      { name: "move_out_date", label: "Move-Out Date", width: 200 },
      { name: "deposit_held", label: "Original Deposit Held", width: 200 },
    ]);
    d.heading("Deductions");
    const colWidths = [280, 90, 90];
    const colLabels = ["Description", "Amount", "Ref."];
    for (let row = 1; row <= 6; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `deduction_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 16 },
      );
    }
    d.fieldRow([
      { name: "total_deductions", label: "Total Deductions", width: 200 },
      { name: "amount_returned", label: "Amount Being Returned", width: 200 },
    ]);
    d.disclaimer(
      "Most jurisdictions require an itemized deduction statement within a strict deadline (often 14-30 days after move-out) and returning any undisputed balance within that same window — confirm your jurisdiction's exact deadline and required format.",
    );
  });
}

// --- 40. Lease Renewal / Extension Agreement -----------------------------------------
async function leaseRenewal() {
  return build((d) => {
    d.title("Lease Renewal / Extension Agreement");
    d.paragraph("This Renewal extends the existing Lease Agreement between the Landlord and Tenant identified below on the terms stated here.");
    d.fieldRow([
      { name: "landlord_name", label: "Landlord Name", width: 260 },
      { name: "tenant_name", label: "Tenant Name", width: 220 },
    ]);
    d.fieldRow([{ name: "property_address", label: "Property Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "original_lease_date", label: "Original Lease Date", width: 220 },
      { name: "current_end_date", label: "Current Lease End Date", width: 220 },
    ]);
    d.fieldRow([
      { name: "new_end_date", label: "New Lease End Date", width: 220 },
      { name: "new_monthly_rent", label: "Monthly Rent for Renewal Term", width: 220 },
    ]);
    d.checkboxRow("other_terms_unchanged", "All other terms of the original Lease remain unchanged");
    d.fieldRow([{ name: "updated_terms", label: "Updated Terms (if any)", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.signatureBlock("Landlord", "Tenant");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 41. Property Inspection Report --------------------------------------------------
async function propertyInspectionReport() {
  return build((d) => {
    d.title("Property Inspection Report");
    d.fieldRow([
      { name: "property_address", label: "Property Address", width: 300 },
      { name: "inspection_date", label: "Inspection Date", width: 200 },
    ]);
    d.fieldRow([
      { name: "inspector_name", label: "Inspector Name", width: 200 },
      { name: "inspection_type", label: "Inspection Type (routine/move-out/annual)", width: 280 },
    ]);
    d.heading("Findings by Area");
    for (const area of ["Roof & Exterior", "Foundation & Structure", "Electrical", "Plumbing", "HVAC", "Interior / Fixtures", "Safety (smoke/CO detectors, exits)"]) {
      d.fieldRow([{ name: area.toLowerCase().replace(/[^a-z]+/g, "_"), label: area, width: CONTENT_W }]);
    }
    d.fieldRow([{ name: "overall_condition", label: "Overall Condition Summary", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "recommended_repairs", label: "Recommended Repairs / Follow-Up", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([{ name: "inspector_signature", label: "Inspector — Signature (type full name)", width: 300 }]);
    d.disclaimer("Template provided for general reference only, and is not a substitute for a licensed home inspector's report where one is required (e.g. for a real estate transaction).");
  });
}

// --- 42. HOA Violation Notice ---------------------------------------------------------
async function hoaViolationNotice() {
  return build((d) => {
    d.title("HOA Violation Notice");
    d.fieldRow([
      { name: "association_name", label: "Association Name", width: 260 },
      { name: "owner_name", label: "Property Owner Name", width: 220 },
    ]);
    d.fieldRow([{ name: "property_address", label: "Property Address", width: CONTENT_W }]);
    d.fieldRow([{ name: "notice_date", label: "Date of Notice", width: 200 }]);
    d.dropdownRow("violation_type", "Type of Violation", ["Architectural / exterior", "Landscaping", "Parking", "Noise", "Pet", "Other"], { width: 260 });
    d.fieldRow([{ name: "violation_description", label: "Description of Violation", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "governing_provision", label: "CC&R / Bylaw Provision Cited", width: CONTENT_W }]);
    d.fieldRow([{ name: "cure_by_date", label: "Deadline to Cure", width: 220 }]);
    d.fieldRow([{ name: "potential_fine", label: "Potential Fine if Not Cured", width: 220 }]);
    d.disclaimer("HOA enforcement procedures (required notice, hearing rights, fine limits) are governed by your association's own governing documents and state HOA law — confirm compliance before issuing.");
  });
}

// --- 43. Roommate Agreement -----------------------------------------------------------
async function roommateAgreement() {
  return build((d) => {
    d.title("Roommate Agreement");
    d.paragraph("This Agreement is between the co-tenants identified below, sharing the residence described below, and is intended to supplement (not replace) any lease with the landlord.");
    d.fieldRow([{ name: "property_address", label: "Shared Residence Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "roommate_1", label: "Roommate 1 Name", width: 160 },
      { name: "roommate_2", label: "Roommate 2 Name", width: 160 },
      { name: "roommate_3", label: "Roommate 3 Name (if any)", width: 150 },
    ]);
    d.fieldRow([
      { name: "total_rent", label: "Total Monthly Rent", width: 180 },
      { name: "rent_split", label: "Each Roommate's Share", width: 220 },
    ]);
    d.fieldRow([{ name: "utilities_split", label: "Utilities / Shared Expenses Split", width: CONTENT_W }]);
    d.fieldRow([{ name: "chore_schedule", label: "Chore / Cleaning Schedule", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "house_rules", label: "House Rules (guests, quiet hours, shared items)", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([
      { name: "roommate_1_signature", label: "Roommate 1 — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
      { name: "roommate_2_signature", label: "Roommate 2 — Signature (type full name)", width: (CONTENT_W - 24) / 2 },
    ]);
    d.disclaimer("This is a private agreement between roommates and does not modify anyone's obligations to the landlord under the actual lease.");
  });
}

// --- 44. Short-Term Rental Agreement --------------------------------------------------
async function shortTermRentalAgreement() {
  return build((d) => {
    d.title("Short-Term Rental Agreement");
    d.paragraph("This Agreement covers a short-term stay at the property described below between the Host and Guest identified here.");
    d.fieldRow([
      { name: "host_name", label: "Host Name", width: 260 },
      { name: "guest_name", label: "Guest Name", width: 220 },
    ]);
    d.fieldRow([{ name: "property_address", label: "Property Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "checkin_date", label: "Check-In Date", width: 180 },
      { name: "checkout_date", label: "Check-Out Date", width: 180 },
      { name: "max_guests", label: "Max Guests", width: 120 },
    ]);
    d.fieldRow([
      { name: "total_rate", label: "Total Rate", width: 160 },
      { name: "cleaning_fee", label: "Cleaning Fee", width: 140 },
      { name: "security_deposit", label: "Security Deposit", width: 160 },
    ]);
    d.dropdownRow("cancellation_policy", "Cancellation Policy", ["Flexible", "Moderate", "Firm", "Strict"], { width: 200 });
    d.checkboxRow("no_smoking", "No smoking on the property");
    d.checkboxRow("no_pets", "No pets allowed");
    d.checkboxRow("no_parties", "No parties or events");
    d.fieldRow([{ name: "house_rules", label: "Additional House Rules", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.signatureBlock("Host", "Guest");
    d.disclaimer(GENERIC_DISCLAIMER + " Short-term rental regulations (permits, occupancy taxes, local restrictions) vary significantly by city — confirm compliance before hosting.");
  });
}

// --- 45. Rent Receipt ------------------------------------------------------------------
async function rentReceipt() {
  return build((d) => {
    d.title("Rent Receipt");
    d.fieldRow([
      { name: "receipt_number", label: "Receipt #", width: 160 },
      { name: "payment_date", label: "Date of Payment", width: 180 },
    ]);
    d.fieldRow([
      { name: "tenant_name", label: "Tenant Name", width: 240 },
      { name: "property_address", label: "Property / Unit", width: 240 },
    ]);
    d.fieldRow([
      { name: "period_covered", label: "Rental Period Covered", width: 220 },
      { name: "amount_paid", label: "Amount Paid", width: 180 },
    ]);
    d.dropdownRow("payment_method", "Payment Method", ["Cash", "Check", "Bank transfer", "Money order", "Other"], { width: 220 });
    d.fieldRow([{ name: "balance_remaining", label: "Balance Remaining (if partial payment)", width: 260 }]);
    d.fieldRow([{ name: "received_by", label: "Received By (type full name)", width: 300 }]);
    d.disclaimer("Template provided for general reference only.");
  });
}

// --- 46. Quote / Estimate -----------------------------------------------------------
async function quoteEstimate() {
  return build((d) => {
    d.title("Quote / Estimate");
    d.fieldRow([
      { name: "quote_number", label: "Quote #", width: 140 },
      { name: "quote_date", label: "Date", width: 140 },
      { name: "valid_until", label: "Valid Until", width: 180 },
    ]);
    d.heading("From");
    d.fieldRow([{ name: "from_business", label: "Business Name", width: CONTENT_W }]);
    d.heading("Prepared For");
    d.fieldRow([{ name: "client_name", label: "Client Name", width: CONTENT_W }]);
    d.heading("Scope & Pricing");
    const colWidths = [220, 60, 90, 90];
    const colLabels = ["Description", "Qty", "Rate", "Amount"];
    for (let row = 1; row <= 5; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `item_${row}_${label.toLowerCase()}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 18 },
      );
    }
    d.fieldRow([{ name: "estimated_total", label: "Estimated Total", width: 200 }]);
    d.fieldRow([{ name: "terms", label: "Terms & Assumptions", width: CONTENT_W, multiline: true }]);
    d.disclaimer("An estimate, not a final invoice — actual charges may vary based on the terms noted above.");
  });
}

// --- 47. Receipt ----------------------------------------------------------------------
async function genericReceipt() {
  return build((d) => {
    d.title("Receipt");
    d.fieldRow([
      { name: "receipt_number", label: "Receipt #", width: 160 },
      { name: "date", label: "Date", width: 180 },
    ]);
    d.fieldRow([
      { name: "received_from", label: "Received From", width: 300 },
      { name: "amount", label: "Amount", width: 180 },
    ]);
    d.fieldRow([{ name: "payment_for", label: "For Payment Of", width: CONTENT_W }]);
    d.dropdownRow("payment_method", "Payment Method", ["Cash", "Check", "Card", "Bank transfer", "Other"], { width: 200 });
    d.fieldRow([{ name: "received_by", label: "Received By (type full name)", width: 300 }]);
    d.disclaimer("Template provided for general reference only.");
  });
}

// --- 48. Timesheet ----------------------------------------------------------------------
async function timesheet() {
  return build((d) => {
    d.title("Timesheet");
    d.fieldRow([
      { name: "employee_name", label: "Employee Name", width: 260 },
      { name: "pay_period", label: "Pay Period", width: 220 },
    ]);
    d.heading("Hours Worked");
    const colWidths = [90, 90, 90, 90, 100];
    const colLabels = ["Date", "Time In", "Time Out", "Break", "Total Hrs"];
    for (let row = 1; row <= 7; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `day_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 16 },
      );
    }
    d.fieldRow([{ name: "total_hours", label: "Total Hours for Period", width: 220 }]);
    d.spacer(6);
    d.signatureBlock("Employee", "Supervisor Approval");
    d.disclaimer("Template provided for general reference only. Confirm this meets your organization's payroll and wage-and-hour recordkeeping requirements.");
  });
}

// --- 49. Expense Report -------------------------------------------------------------
async function expenseReport() {
  return build((d) => {
    d.title("Expense Report");
    d.fieldRow([
      { name: "employee_name", label: "Employee Name", width: 260 },
      { name: "department", label: "Department", width: 220 },
    ]);
    d.fieldRow([
      { name: "report_period", label: "Report Period", width: 220 },
      { name: "report_date", label: "Date Submitted", width: 200 },
    ]);
    d.heading("Expenses");
    const colWidths = [80, 190, 90, 90];
    const colLabels = ["Date", "Description", "Category", "Amount"];
    for (let row = 1; row <= 8; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `expense_${row}_${label.toLowerCase()}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 16 },
      );
    }
    d.fieldRow([{ name: "total_amount", label: "Total Amount Requested", width: 220 }]);
    d.checkboxRow("receipts_attached", "Receipts attached for all expenses over the required threshold");
    d.spacer(6);
    d.signatureBlock("Employee", "Manager Approval");
    d.disclaimer("Template provided for general reference only. Align expense categories and receipt requirements with your organization's own expense policy.");
  });
}

// --- 50. Reference Letter -----------------------------------------------------------
async function referenceLetter() {
  return build((d) => {
    d.title("Reference Letter");
    d.fieldRow([
      { name: "date", label: "Date", width: 200 },
      { name: "referee_name", label: "Person Being Referred", width: 260 },
    ]);
    d.fieldRow([
      { name: "author_name", label: "Your Name", width: 260 },
      { name: "author_title", label: "Your Title / Relationship", width: 220 },
    ]);
    d.fieldRow([{ name: "relationship_duration", label: "How Long / In What Capacity You've Known Them", width: CONTENT_W }]);
    d.fieldRow([{ name: "reference_body", label: "Reference (skills, character, recommendation)", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "contact_info", label: "Your Contact Information (for follow-up questions)", width: CONTENT_W }]);
    d.spacer(6);
    d.fieldRow([{ name: "author_signature", label: "Signature (type full name)", width: 300 }]);
    d.disclaimer("Template provided for general reference only.");
  });
}

// --- 51. Resignation Letter ----------------------------------------------------------
async function resignationLetter() {
  return build((d) => {
    d.title("Resignation Letter");
    d.fieldRow([
      { name: "date", label: "Date", width: 200 },
      { name: "employee_name", label: "Your Name", width: 260 },
    ]);
    d.fieldRow([
      { name: "manager_name", label: "Manager / Recipient Name", width: 260 },
      { name: "company_name", label: "Company Name", width: 220 },
    ]);
    d.fieldRow([{ name: "last_day", label: "Intended Last Day of Work", width: 220 }]);
    d.fieldRow([{ name: "reason", label: "Reason (optional)", width: CONTENT_W }]);
    d.fieldRow([{ name: "additional_notes", label: "Additional Notes (transition plan, thanks, etc.)", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([{ name: "employee_signature", label: "Signature (type full name)", width: 300 }]);
    d.disclaimer("Check your employment contract and company policy for any required notice period before finalizing your last day.");
  });
}

// --- 52. Meeting Agenda -------------------------------------------------------------
async function meetingAgenda() {
  return build((d) => {
    d.title("Meeting Agenda");
    d.fieldRow([
      { name: "meeting_title", label: "Meeting Title", width: 240 },
      { name: "meeting_date", label: "Date", width: 130 },
      { name: "meeting_time", label: "Time", width: 106 },
    ]);
    d.fieldRow([
      { name: "location", label: "Location / Method", width: 270 },
      { name: "facilitator", label: "Facilitator", width: 200 },
    ]);
    d.fieldRow([{ name: "attendees", label: "Attendees", width: CONTENT_W }]);
    d.heading("Agenda Items");
    for (let i = 1; i <= 6; i++) {
      d.fieldRow([
        { name: `item_${i}_topic`, label: `${i}. Topic`, width: 300 },
        { name: `item_${i}_owner`, label: "Owner", width: 120 },
        { name: `item_${i}_time`, label: "Time Allotted", width: 60 },
      ]);
    }
    d.fieldRow([{ name: "goals", label: "Meeting Goals / Desired Outcomes", width: CONTENT_W, multiline: true }]);
    d.disclaimer("Template provided for general reference only.");
  });
}

// --- 53. Budget Request Form ---------------------------------------------------------
async function budgetRequestForm() {
  return build((d) => {
    d.title("Budget Request Form");
    d.fieldRow([
      { name: "requestor_name", label: "Requestor Name", width: 260 },
      { name: "department", label: "Department", width: 220 },
    ]);
    d.fieldRow([
      { name: "fiscal_period", label: "Fiscal Period", width: 220 },
      { name: "request_date", label: "Date Submitted", width: 200 },
    ]);
    d.fieldRow([{ name: "purpose", label: "Purpose of Request", width: CONTENT_W, multiline: true }]);
    d.heading("Itemized Amounts");
    const colWidths = [280, 90, 90];
    const colLabels = ["Line Item", "Amount", "Category"];
    for (let row = 1; row <= 6; row++) {
      d.fieldRow(
        colLabels.map((label, i) => ({ name: `line_${row}_${label.toLowerCase().replace(/[^a-z]/g, "")}`, label: row === 1 ? label : "", width: colWidths[i] })),
        { height: 16 },
      );
    }
    d.fieldRow([{ name: "total_requested", label: "Total Requested", width: 220 }]);
    d.fieldRow([{ name: "justification", label: "Business Justification", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.signatureBlock("Requestor", "Budget Approver");
    d.disclaimer("Template provided for general reference only. Align approval thresholds and categories with your organization's own budgeting policy.");
  });
}

// --- 54. Internal Memo ---------------------------------------------------------------
async function internalMemo() {
  return build((d) => {
    d.title("Internal Memo");
    d.fieldRow([
      { name: "to", label: "To", width: 260 },
      { name: "from", label: "From", width: 220 },
    ]);
    d.fieldRow([
      { name: "date", label: "Date", width: 180 },
      { name: "subject", label: "Subject", width: 300 },
    ]);
    d.fieldRow([{ name: "message", label: "Message", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "action_required", label: "Action Required (if any)", width: CONTENT_W }]);
    d.disclaimer("Template provided for general reference only.");
  });
}

// --- 55. Change Order Form ------------------------------------------------------------
async function changeOrderForm() {
  return build((d) => {
    d.title("Change Order Form");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "change_order_number", label: "Change Order #", width: 180 },
    ]);
    d.fieldRow([
      { name: "requested_by", label: "Requested By", width: 260 },
      { name: "date", label: "Date", width: 200 },
    ]);
    d.fieldRow([{ name: "description_of_change", label: "Description of Change", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "reason_for_change", label: "Reason for Change", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "cost_impact", label: "Cost Impact (+/-)", width: 220 },
      { name: "schedule_impact", label: "Schedule Impact (+/- days)", width: 240 },
    ]);
    d.spacer(6);
    d.signatureBlock("Requestor", "Approving Authority");
    d.disclaimer("Template provided for general reference only. Confirm this meets any contract-specific change-order procedure that governs the underlying agreement.");
  });
}

// --- 56. Independent Contractor Agreement --------------------------------------------
async function independentContractorAgreement() {
  return build((d) => {
    d.title("Independent Contractor Agreement");
    d.paragraph('This Agreement is entered into between the Client and Contractor identified below, for the services described here.');
    d.fieldRow([
      { name: "client_name", label: "Client Name", width: 260 },
      { name: "contractor_name", label: "Contractor Name", width: 220 },
    ]);
    d.fieldRow([{ name: "services_description", label: "Description of Services", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "payment_amount", label: "Payment Amount / Rate", width: 220 },
      { name: "payment_schedule", label: "Payment Schedule", width: 220 },
    ]);
    d.fieldRow([
      { name: "start_date", label: "Start Date", width: 180 },
      { name: "end_date", label: "End Date (if applicable)", width: 220 },
    ]);
    d.paragraph(
      "1. Independent Contractor Status. Contractor is an independent contractor, not an employee, and is responsible for their own taxes, insurance, and benefits. 2. Ownership of Work Product. Work product created under this Agreement belongs to Client upon full payment, unless stated otherwise. 3. No Exclusivity. Unless stated otherwise, Contractor may perform services for other clients.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Client", "Contractor");
    d.disclaimer(GENERIC_DISCLAIMER + " Worker classification (employee vs. independent contractor) is governed by specific legal tests that vary by jurisdiction and agency — misclassification carries real legal and tax risk. Confirm this classification is correct before relying on this Agreement.");
  });
}

// --- 57. Purchase Agreement (general goods/business) -----------------------------------
async function purchaseAgreement() {
  return build((d) => {
    d.title("Purchase Agreement");
    d.paragraph("This Agreement documents the sale of the item(s) or business assets described below from the Seller to the Buyer identified here.");
    d.fieldRow([
      { name: "seller_name", label: "Seller Name", width: 260 },
      { name: "buyer_name", label: "Buyer Name", width: 220 },
    ]);
    d.fieldRow([{ name: "item_description", label: "Description of What's Being Purchased", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "purchase_price", label: "Purchase Price", width: 200 },
      { name: "deposit_amount", label: "Deposit (if any)", width: 200 },
    ]);
    d.fieldRow([
      { name: "closing_date", label: "Closing / Delivery Date", width: 220 },
      { name: "payment_method", label: "Payment Method", width: 220 },
    ]);
    d.checkboxRow("as_is", "Sold \"as is\" with no warranties");
    d.fieldRow([{ name: "contingencies", label: "Contingencies (financing, inspection, etc.)", width: CONTENT_W }]);
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Seller", "Buyer");
    d.disclaimer(GENERIC_DISCLAIMER + " For real estate or business-asset purchases specifically, additional disclosures, title work, and regulatory filings are typically required — have this reviewed by qualified counsel.");
  });
}

// --- 58. Partnership Agreement ---------------------------------------------------------
async function partnershipAgreement() {
  return build((d) => {
    d.title("Partnership Agreement");
    d.paragraph("This Partnership Agreement is entered into by the Partners identified below to operate the business described here as a partnership.");
    d.fieldRow([{ name: "business_name", label: "Partnership / Business Name", width: CONTENT_W }]);
    d.fieldRow([
      { name: "partner_1", label: "Partner 1 Name", width: 200 },
      { name: "partner_1_share", label: "Ownership %", width: 90 },
      { name: "partner_2", label: "Partner 2 Name", width: 190 },
    ]);
    d.fieldRow([{ name: "partner_2_share", label: "Partner 2 Ownership %", width: 180 }]);
    d.fieldRow([{ name: "capital_contributions", label: "Initial Capital Contributions (per partner)", width: CONTENT_W }]);
    d.paragraph(
      "1. Profit and Loss Sharing. Profits and losses are shared in proportion to ownership percentage unless stated otherwise. 2. Management. Each partner has an equal voice in management unless stated otherwise. 3. Withdrawal. A partner may withdraw upon written notice as specified below; the remaining partners may continue the business.",
    );
    d.fieldRow([{ name: "withdrawal_notice_period", label: "Required Notice Period to Withdraw", width: 260 }]);
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Partner 1", "Partner 2");
    d.disclaimer(GENERIC_DISCLAIMER + " Partnership taxation, liability exposure, and dissolution rules vary by entity type and jurisdiction — have this reviewed by a qualified attorney or accountant before forming a partnership.");
  });
}

// --- 59. LLC Operating Agreement --------------------------------------------------------
async function operatingAgreementLLC() {
  return build((d) => {
    d.title("LLC Operating Agreement");
    d.paragraph("This Operating Agreement governs the internal operations of the limited liability company identified below.");
    d.fieldRow([
      { name: "llc_name", label: "LLC Name", width: 300 },
      { name: "formation_state", label: "State of Formation", width: 200 },
    ]);
    d.fieldRow([{ name: "principal_address", label: "Principal Business Address", width: CONTENT_W }]);
    d.heading("Members");
    d.fieldRow([
      { name: "member_1", label: "Member 1 Name", width: 200 },
      { name: "member_1_percent", label: "Ownership %", width: 90 },
      { name: "member_2", label: "Member 2 Name", width: 190 },
    ]);
    d.fieldRow([{ name: "member_2_percent", label: "Member 2 Ownership %", width: 180 }]);
    d.dropdownRow("management_structure", "Management Structure", ["Member-managed", "Manager-managed"], { width: 220 });
    d.paragraph(
      "1. Capital Contributions. Each member's initial contribution is as recorded in the company's books. 2. Distributions. Distributions are made in proportion to ownership percentage unless stated otherwise. 3. Limited Liability. No member is personally liable for the LLC's debts solely by virtue of membership.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Member 1", "Member 2");
    d.disclaimer(GENERIC_DISCLAIMER + " LLC statutes and default rules vary significantly by state — have this reviewed by a qualified attorney to confirm it matches your state's requirements and your actual intentions.");
  });
}

// --- 60. Employment Contract (full) -----------------------------------------------------
async function employmentContract() {
  return build((d) => {
    d.title("Employment Contract");
    d.paragraph("This Employment Contract is entered into between the Employer and Employee identified below.");
    d.fieldRow([
      { name: "employer_name", label: "Employer Name", width: 260 },
      { name: "employee_name", label: "Employee Name", width: 220 },
    ]);
    d.fieldRow([
      { name: "job_title", label: "Job Title", width: 260 },
      { name: "start_date", label: "Start Date", width: 220 },
    ]);
    d.dropdownRow("employment_type", "Employment Type", ["At-will", "Fixed-term", "Probationary"], { width: 220 });
    d.fieldRow([{ name: "contract_end_date", label: "Contract End Date (if fixed-term)", width: 260 }]);
    d.fieldRow([
      { name: "compensation", label: "Compensation", width: 220 },
      { name: "pay_frequency", label: "Pay Frequency", width: 220 },
    ]);
    d.fieldRow([{ name: "benefits", label: "Benefits", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "duties", label: "Duties and Responsibilities", width: CONTENT_W, multiline: true }]);
    d.dropdownRow("termination_notice", "Termination Notice Period", ["None (at-will)", "2 weeks", "30 days", "60 days"], { width: 220 });
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Employer", "Employee");
    d.disclaimer(GENERIC_DISCLAIMER + " Employment terms and required disclosures vary by jurisdiction — have this reviewed by qualified employment counsel or HR guidance specific to your location.");
  });
}

// --- 61. Affidavit ------------------------------------------------------------------------
async function affidavit() {
  return build((d) => {
    d.title("Affidavit");
    d.fieldRow([
      { name: "affiant_name", label: "Affiant (Person Making This Statement)", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    d.fieldRow([{ name: "affiant_address", label: "Affiant Address", width: CONTENT_W }]);
    d.paragraph("I, the Affiant identified above, being duly sworn, depose and state the following under penalty of perjury:");
    d.fieldRow([{ name: "statement", label: "Statement of Facts", width: CONTENT_W, multiline: true }]);
    d.paragraph("I declare that the foregoing is true and correct to the best of my knowledge.");
    d.fieldRow([{ name: "affiant_signature", label: "Affiant — Signature (type full name)", width: 300 }]);
    d.heading("Notary Acknowledgment (if required)");
    d.fieldRow([
      { name: "notary_name", label: "Notary Name", width: 260 },
      { name: "notary_commission_expires", label: "Commission Expires", width: 220 },
    ]);
    d.disclaimer(
      "Affidavits are typically required to be signed in person before a notary public or other authorized officer to be legally valid — this template alone does not satisfy that requirement. Confirm your jurisdiction's exact execution requirements before use, and never state anything here you don't know to be true (affidavits carry criminal perjury penalties).",
    );
  });
}

// --- 62. Cease and Desist Letter ---------------------------------------------------------
async function ceaseAndDesistLetter() {
  return build((d) => {
    d.title("Cease and Desist Letter");
    d.fieldRow([
      { name: "sender_name", label: "Your Name / Organization", width: 260 },
      { name: "date", label: "Date", width: 200 },
    ]);
    d.fieldRow([{ name: "recipient_name", label: "Recipient Name / Organization", width: CONTENT_W }]);
    d.fieldRow([{ name: "recipient_address", label: "Recipient Address", width: CONTENT_W }]);
    d.dropdownRow("conduct_type", "Type of Conduct", ["Harassment", "Defamation", "Trademark/copyright infringement", "Breach of contract", "Other"], { width: 300 });
    d.fieldRow([{ name: "conduct_description", label: "Description of the Conduct at Issue", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "demand", label: "What You're Demanding They Stop / Do", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "deadline", label: "Deadline to Comply", width: 220 }]);
    d.paragraph("Failure to comply by the above deadline may result in further legal action to protect my/our rights.");
    d.spacer(6);
    d.fieldRow([{ name: "sender_signature", label: "Signature (type full name)", width: 300 }]);
    d.disclaimer("This is a serious legal document with real consequences depending on how it's used and responded to — have it reviewed by a qualified attorney before sending, especially for anything beyond a minor personal dispute.");
  });
}

// --- 63. Demand Letter ---------------------------------------------------------------------
async function demandLetter() {
  return build((d) => {
    d.title("Demand Letter");
    d.fieldRow([
      { name: "sender_name", label: "Your Name", width: 260 },
      { name: "date", label: "Date", width: 200 },
    ]);
    d.fieldRow([{ name: "recipient_name", label: "Recipient Name", width: CONTENT_W }]);
    d.fieldRow([{ name: "recipient_address", label: "Recipient Address", width: CONTENT_W }]);
    d.fieldRow([{ name: "background", label: "Background of the Dispute", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "amount_demanded", label: "Amount Demanded", width: 220 },
      { name: "deadline", label: "Deadline to Respond / Pay", width: 220 },
    ]);
    d.paragraph("If this matter is not resolved by the deadline above, I may pursue further legal remedies, including filing a claim in the appropriate court.");
    d.spacer(6);
    d.fieldRow([{ name: "sender_signature", label: "Signature (type full name)", width: 300 }]);
    d.disclaimer("Small claims court has its own specific procedures and dollar limits by jurisdiction. For disputes beyond a small personal amount, have this letter reviewed by a qualified attorney before sending.");
  });
}

// --- 64. Settlement Agreement ------------------------------------------------------------
async function settlementAgreement() {
  return build((d) => {
    d.title("Settlement Agreement");
    d.paragraph("This Settlement Agreement resolves the dispute between the Parties identified below on the terms set out here.");
    d.fieldRow([
      { name: "party_a", label: "Party A", width: 260 },
      { name: "party_b", label: "Party B", width: 220 },
    ]);
    d.fieldRow([{ name: "dispute_description", label: "Description of the Dispute Being Settled", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "settlement_amount", label: "Settlement Amount (if any)", width: 220 },
      { name: "payment_deadline", label: "Payment Deadline", width: 220 },
    ]);
    d.paragraph(
      "1. Mutual Release. Upon performance of the terms above, each Party releases the other from all claims related to the dispute described above. 2. No Admission. This Agreement is not an admission of liability or wrongdoing by either Party. 3. Confidentiality. The Parties agree to keep the terms of this settlement confidential, except as required by law.",
    );
    d.fieldRow([{ name: "governing_law", label: "Governing Law (State / Country)", width: 260 }]);
    d.spacer(6);
    d.signatureBlock("Party A", "Party B");
    d.disclaimer(GENERIC_DISCLAIMER + " Settlement agreements resolving an active legal claim often need to be filed with or approved by a court — confirm the requirements for your specific matter with qualified counsel.");
  });
}

// --- 65. Notary Acknowledgment -------------------------------------------------------------
async function notaryAcknowledgment() {
  return build((d) => {
    d.title("Notary Acknowledgment");
    d.fieldRow([
      { name: "state", label: "State", width: 200 },
      { name: "county", label: "County", width: 200 },
    ]);
    d.paragraph(
      "On the date below, before me personally appeared the individual named below, known to me (or proved to me on the basis of satisfactory evidence) to be the person whose name is subscribed to the attached document, and acknowledged executing it for the purposes stated therein.",
    );
    d.fieldRow([
      { name: "signer_name", label: "Name of Signer", width: 300 },
      { name: "date_acknowledged", label: "Date", width: 200 },
    ]);
    d.spacer(6);
    d.fieldRow([
      { name: "notary_signature", label: "Notary Public — Signature (type full name)", width: 300 },
      { name: "commission_expires", label: "My Commission Expires", width: 200 },
    ]);
    d.disclaimer(
      "This is a general-reference notarial certificate only — most jurisdictions require the exact statutory wording for a valid notarial acknowledgment, and notarization itself requires the signer to personally appear before a commissioned notary. Use your state/jurisdiction's required official wording, not this template's, for anything that actually needs to be notarized.",
    );
  });
}

// --- 66. Contract Addendum -----------------------------------------------------------------
async function contractAddendum() {
  return build((d) => {
    d.title("Contract Addendum");
    d.paragraph("This Addendum amends the Agreement identified below between the Parties identified here, effective as of the date below.");
    d.fieldRow([
      { name: "original_agreement_name", label: "Original Agreement (title and date)", width: CONTENT_W },
    ]);
    d.fieldRow([
      { name: "party_a", label: "Party A", width: 260 },
      { name: "party_b", label: "Party B", width: 220 },
    ]);
    d.fieldRow([{ name: "effective_date", label: "Effective Date of This Addendum", width: 220 }]);
    d.fieldRow([{ name: "changes_description", label: "Description of Changes to the Original Agreement", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("other_terms_unchanged", "All other terms of the original Agreement remain in full force and effect");
    d.spacer(6);
    d.signatureBlock("Party A", "Party B");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

const MEDICAL_DISCLAIMER =
  "This is a general-reference template, not medical or legal advice, and does not by itself satisfy HIPAA or other health-privacy regulatory requirements. Pair it with your practice's own privacy-practices notice, confirm required fields for your specialty and jurisdiction, and have a qualified professional review it.";

// --- 67. Employee Tax Withholding Form (unofficial, W-4-style) --------------------------
async function employeeTaxWithholdingForm() {
  return build((d) => {
    d.title("Employee Tax Withholding Form");
    d.paragraph(
      "This is an unofficial, general-reference withholding worksheet an employer can use to collect an employee's withholding elections. It is not a substitute for the actual IRS Form W-4 or any state-specific equivalent, which employees must also file where required.",
      { size: 8.5, color: FAINT },
    );
    d.heading("Employee Information");
    d.fieldRow([
      { name: "employee_name", label: "Full Legal Name", width: 260 },
      { name: "ssn_last4", label: "SSN (last 4 digits)", width: 120 },
      { name: "date", label: "Date", width: 100 },
    ]);
    d.fieldRow([{ name: "address", label: "Home Address", width: CONTENT_W }]);
    d.radioRow("filing_status", "Filing Status", ["Single", "Married filing jointly", "Head of household"]);
    d.heading("Withholding Adjustments");
    d.fieldRow([
      { name: "dependents_amount", label: "Dependent/Credit Amount ($)", width: 220 },
      { name: "other_income", label: "Other Income (not from jobs, $)", width: 220 },
    ]);
    d.fieldRow([
      { name: "deductions", label: "Deductions (other than standard, $)", width: 220 },
      { name: "extra_withholding", label: "Extra Withholding Per Pay Period ($)", width: 220 },
    ]);
    d.checkboxRow("multiple_jobs", "Employee holds multiple jobs or spouse also works (Two-Earners worksheet applies)");
    d.spacer(6);
    d.paragraph("Under penalties of perjury, I declare this information is true, correct, and complete to the best of my knowledge.");
    d.fieldRow([
      { name: "employee_signature", label: "Employee — Signature (type full name)", width: 300 },
      { name: "signature_date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 68. Employee Handbook Acknowledgment -----------------------------------------------
async function employeeHandbookAcknowledgment() {
  return build((d) => {
    d.title("Employee Handbook Acknowledgment");
    d.paragraph(
      "I acknowledge that I have received, read, and understand the Employee Handbook described below, and agree to comply with the policies it contains. I understand the handbook is not an employment contract and that its policies may be revised at any time.",
    );
    d.fieldRow([
      { name: "employee_name", label: "Employee Full Name", width: 260 },
      { name: "employee_id", label: "Employee ID (if applicable)", width: 220 },
    ]);
    d.fieldRow([
      { name: "handbook_title", label: "Handbook Title / Version", width: 260 },
      { name: "handbook_date", label: "Handbook Date", width: 220 },
    ]);
    d.checkboxRow("received_electronic", "I received an electronic copy of the handbook");
    d.checkboxRow("received_printed", "I received a printed copy of the handbook");
    d.checkboxRow("had_opportunity_to_ask", "I had the opportunity to ask questions about its contents");
    d.spacer(6);
    d.fieldRow([
      { name: "employee_signature", label: "Employee — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 69. Termination Notice --------------------------------------------------------------
async function terminationNotice() {
  return build((d) => {
    d.title("Notice of Employment Termination");
    d.fieldRow([
      { name: "employee_name", label: "Employee Full Name", width: 220 },
      { name: "employee_id", label: "Employee ID", width: 140 },
      { name: "department", label: "Department", width: 120 },
    ]);
    d.fieldRow([
      { name: "hire_date", label: "Original Hire Date", width: 180 },
      { name: "termination_date", label: "Effective Termination Date", width: 200 },
    ]);
    d.radioRow("termination_type", "Type", ["Voluntary", "Involuntary", "Layoff / Reduction in force", "End of contract"]);
    d.fieldRow([{ name: "reason", label: "Reason for Termination", width: CONTENT_W, multiline: true }]);
    d.heading("Final Pay & Benefits");
    d.fieldRow([
      { name: "final_paycheck_date", label: "Final Paycheck Date", width: 220 },
      { name: "unused_pto_payout", label: "Unused PTO Payout ($)", width: 220 },
    ]);
    d.checkboxRow("benefits_info_provided", "COBRA / benefits continuation information provided");
    d.checkboxRow("company_property_returned", "All company property has been returned");
    d.spacer(6);
    d.signatureBlock("Employer Representative", "Employee");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 70. Background Check Authorization ---------------------------------------------------
async function backgroundCheckAuthorization() {
  return build((d) => {
    d.title("Background Check Disclosure & Authorization");
    d.paragraph(
      "I understand that, in connection with my application or continued employment, a consumer report and/or investigative consumer report may be obtained about me, which may include criminal history, employment and education verification, and other background information as permitted by applicable law.",
    );
    d.fieldRow([
      { name: "full_name", label: "Full Legal Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 150 },
    ]);
    d.fieldRow([{ name: "address", label: "Current Address", width: CONTENT_W }]);
    d.fieldRow([{ name: "prior_addresses", label: "Prior Addresses (last 7 years, if applicable)", width: CONTENT_W }]);
    d.checkboxRow("consent_criminal", "I authorize a criminal history search");
    d.checkboxRow("consent_employment", "I authorize verification of prior employment");
    d.checkboxRow("consent_education", "I authorize verification of education history");
    d.paragraph("I authorize the release of the information described above and understand I may request a copy of any report obtained.");
    d.fieldRow([
      { name: "applicant_signature", label: "Applicant — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(
      "This template does not by itself satisfy the Fair Credit Reporting Act (FCRA) or state-equivalent notice and authorization requirements, which are strict about format and standalone disclosure. Have counsel confirm compliance before use.",
    );
  });
}

// --- 71. Training Attendance Sheet --------------------------------------------------------
async function trainingAttendanceSheet() {
  return build((d) => {
    d.title("Training Attendance Sheet");
    d.fieldRow([
      { name: "training_title", label: "Training / Session Title", width: 300 },
      { name: "date", label: "Date", width: 150 },
    ]);
    d.fieldRow([
      { name: "instructor", label: "Instructor / Facilitator", width: 260 },
      { name: "location", label: "Location", width: 220 },
    ]);
    d.heading("Attendees");
    for (let i = 1; i <= 8; i++) {
      d.fieldRow([
        { name: `attendee_${i}_name`, label: `Attendee ${i} — Name`, width: 220 },
        { name: `attendee_${i}_department`, label: "Department", width: 130 },
        { name: `attendee_${i}_signature`, label: "Signature", width: 110 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 72. Disciplinary Action Form ----------------------------------------------------------
async function disciplinaryActionForm() {
  return build((d) => {
    d.title("Employee Disciplinary Action Form");
    d.fieldRow([
      { name: "employee_name", label: "Employee Full Name", width: 220 },
      { name: "employee_id", label: "Employee ID", width: 140 },
      { name: "date", label: "Date of Incident", width: 120 },
    ]);
    d.radioRow("action_level", "Action Level", ["Verbal warning", "Written warning", "Final warning", "Suspension"]);
    d.fieldRow([{ name: "policy_violated", label: "Policy or Rule Violated", width: CONTENT_W }]);
    d.fieldRow([{ name: "incident_description", label: "Description of Incident", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "prior_incidents", label: "Prior Related Incidents (if any)", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "corrective_action", label: "Expected Corrective Action / Improvement Plan", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("employee_acknowledges", "Employee acknowledges receipt of this notice (not necessarily agreement with its contents)");
    d.spacer(6);
    d.signatureBlock("Supervisor", "Employee");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 73. Promotion Request Form -------------------------------------------------------------
async function promotionRequestForm() {
  return build((d) => {
    d.title("Promotion Request Form");
    d.fieldRow([
      { name: "employee_name", label: "Employee Full Name", width: 260 },
      { name: "current_title", label: "Current Title", width: 220 },
    ]);
    d.fieldRow([
      { name: "proposed_title", label: "Proposed New Title", width: 260 },
      { name: "proposed_salary", label: "Proposed New Salary", width: 220 },
    ]);
    d.fieldRow([{ name: "justification", label: "Justification for Promotion", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "key_accomplishments", label: "Key Accomplishments Supporting This Request", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "requested_effective_date", label: "Requested Effective Date", width: 220 },
      { name: "manager_name", label: "Requesting Manager", width: 220 },
    ]);
    d.spacer(6);
    d.signatureBlock("Requesting Manager", "HR / Approver");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 74. Exit Interview Form -----------------------------------------------------------------
async function exitInterviewForm() {
  return build((d) => {
    d.title("Exit Interview Form");
    d.fieldRow([
      { name: "employee_name", label: "Employee Full Name", width: 260 },
      { name: "last_day", label: "Last Day of Employment", width: 220 },
    ]);
    d.fieldRow([
      { name: "position", label: "Position", width: 260 },
      { name: "manager", label: "Manager", width: 220 },
    ]);
    d.radioRow("departure_reason", "Primary Reason for Leaving", ["New opportunity", "Compensation", "Career growth", "Work environment", "Other"]);
    d.fieldRow([{ name: "reason_details", label: "Details", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "what_worked_well", label: "What Worked Well Here", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "what_could_improve", label: "What Could Be Improved", width: CONTENT_W, multiline: true }]);
    d.radioRow("would_recommend", "Would you recommend this employer to others?", ["Yes", "No", "Maybe"]);
    d.spacer(6);
    d.fieldRow([
      { name: "employee_signature", label: "Employee — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 75. Remote Work Agreement -----------------------------------------------------------------
async function remoteWorkAgreement() {
  return build((d) => {
    d.title("Remote Work Agreement");
    d.paragraph("This Agreement sets the terms under which the Employee identified below may work remotely, subject to the Employer's ongoing policies and business needs.");
    d.fieldRow([
      { name: "employee_name", label: "Employee Full Name", width: 260 },
      { name: "title", label: "Title", width: 220 },
    ]);
    d.radioRow("arrangement_type", "Arrangement", ["Fully remote", "Hybrid", "Occasional"]);
    d.fieldRow([{ name: "remote_work_location", label: "Primary Remote Work Location (address)", width: CONTENT_W }]);
    d.fieldRow([
      { name: "core_hours", label: "Required Core Hours", width: 260 },
      { name: "start_date", label: "Effective Date", width: 220 },
    ]);
    d.heading("Equipment & Expenses");
    d.checkboxRow("company_equipment_provided", "Employer will provide equipment (laptop, monitor, etc.)")
    d.checkboxRow("internet_stipend", "Employer will provide an internet/home-office stipend");
    d.fieldRow([{ name: "equipment_details", label: "Equipment/Stipend Details", width: CONTENT_W }]);
    d.paragraph("Employee agrees to maintain a safe, secure, and confidential work environment and to remain reachable during core hours.");
    d.spacer(6);
    d.signatureBlock("Employer", "Employee");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 76. Medical History Form -----------------------------------------------------------------
async function medicalHistoryForm() {
  return build((d) => {
    d.title("Medical History Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 220 },
      { name: "date_of_birth", label: "Date of Birth", width: 150 },
      { name: "date", label: "Date", width: 100 },
    ]);
    d.heading("Personal Medical History");
    d.fieldRow([{ name: "past_surgeries", label: "Past Surgeries or Hospitalizations", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "chronic_conditions", label: "Chronic Conditions (diabetes, hypertension, etc.)", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "current_medications", label: "Current Medications and Dosages", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "known_allergies", label: "Known Allergies", width: CONTENT_W }]);
    d.heading("Family Medical History");
    d.fieldRow([{ name: "family_history", label: "Relevant Family Medical History", width: CONTENT_W, multiline: true }]);
    d.heading("Lifestyle");
    d.fieldRow([
      { name: "smoking_status", label: "Smoking Status", width: 160 },
      { name: "alcohol_use", label: "Alcohol Use", width: 160 },
      { name: "exercise_frequency", label: "Exercise Frequency", width: 120 },
    ]);
    d.paragraph("I certify the information above is accurate to the best of my knowledge.");
    d.fieldRow([
      { name: "patient_signature", label: "Signature (type full name)", width: 300 },
      { name: "signature_date", label: "Date", width: 160 },
    ]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 77. Insurance Information Form -----------------------------------------------------------
async function insuranceInformationForm() {
  return build((d) => {
    d.title("Patient Insurance Information Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.heading("Primary Insurance");
    d.fieldRow([
      { name: "primary_provider", label: "Insurance Provider", width: 260 },
      { name: "primary_policy_number", label: "Policy / Member Number", width: 220 },
    ]);
    d.fieldRow([
      { name: "primary_group_number", label: "Group Number", width: 220 },
      { name: "primary_holder_name", label: "Policyholder Name (if not patient)", width: 260 },
    ]);
    d.heading("Secondary Insurance (if applicable)");
    d.fieldRow([
      { name: "secondary_provider", label: "Insurance Provider", width: 260 },
      { name: "secondary_policy_number", label: "Policy / Member Number", width: 220 },
    ]);
    d.checkboxRow("assignment_of_benefits", "I authorize payment of medical benefits directly to the provider");
    d.spacer(6);
    d.fieldRow([
      { name: "patient_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 78. Consent for Treatment -----------------------------------------------------------------
async function consentForTreatment() {
  return build((d) => {
    d.title("Consent for Treatment");
    d.paragraph(
      "I voluntarily consent to receive medical evaluation and treatment from the practice named below. I understand that treatment may include examinations, tests, and procedures determined necessary by the treating provider, and that no guarantee has been made about the outcome of treatment.",
    );
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "practice_name", label: "Practice / Provider Name", width: CONTENT_W }]);
    d.checkboxRow("understands_risks", "I understand that all treatment carries some risk, and questions have been answered to my satisfaction");
    d.checkboxRow("consents_to_share", "I consent to sharing relevant health information with other treating providers as needed for my care");
    d.fieldRow([{ name: "representative_relationship", label: "Signing as Legal Representative — Relationship (if applicable)", width: CONTENT_W }]);
    d.spacer(6);
    d.fieldRow([
      { name: "signature", label: "Patient / Representative — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 79. Prescription Request Form ---------------------------------------------------------------
async function prescriptionRequestForm() {
  return build((d) => {
    d.title("Prescription Refill Request Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([
      { name: "pharmacy_name", label: "Pharmacy Name", width: 260 },
      { name: "pharmacy_phone", label: "Pharmacy Phone", width: 220 },
    ]);
    d.heading("Medication Requested");
    d.fieldRow([
      { name: "medication_name", label: "Medication Name", width: 220 },
      { name: "dosage", label: "Dosage", width: 150 },
      { name: "quantity", label: "Quantity", width: 90 },
    ]);
    d.fieldRow([{ name: "prescribing_provider", label: "Prescribing Provider (if known)", width: CONTENT_W }]);
    d.fieldRow([{ name: "notes", label: "Additional Notes for Provider", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([
      { name: "patient_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 80. Vaccination Record ------------------------------------------------------------------------
async function vaccinationRecord() {
  return build((d) => {
    d.title("Vaccination Record");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.heading("Vaccination History");
    for (let i = 1; i <= 6; i++) {
      d.fieldRow([
        { name: `vaccine_${i}_name`, label: `Vaccine ${i}`, width: 170 },
        { name: `vaccine_${i}_date`, label: "Date Administered", width: 110 },
        { name: `vaccine_${i}_lot`, label: "Lot Number", width: 90 },
        { name: `vaccine_${i}_provider`, label: "Administered By", width: 100 },
      ]);
    }
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 81. Lab Requisition Form ------------------------------------------------------------------------
async function labRequisitionForm() {
  return build((d) => {
    d.title("Laboratory Requisition Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 220 },
      { name: "date_of_birth", label: "Date of Birth", width: 150 },
      { name: "date", label: "Date", width: 100 },
    ]);
    d.fieldRow([
      { name: "ordering_provider", label: "Ordering Provider", width: 260 },
      { name: "diagnosis_code", label: "Diagnosis / ICD Code", width: 220 },
    ]);
    d.heading("Tests Requested");
    d.checkboxRow("cbc", "Complete Blood Count (CBC)");
    d.checkboxRow("metabolic_panel", "Comprehensive Metabolic Panel");
    d.checkboxRow("lipid_panel", "Lipid Panel");
    d.checkboxRow("thyroid_panel", "Thyroid Panel");
    d.checkboxRow("urinalysis", "Urinalysis");
    d.fieldRow([{ name: "other_tests", label: "Other Tests Requested", width: CONTENT_W }]);
    d.radioRow("priority", "Priority", ["Routine", "STAT"]);
    d.fieldRow([{ name: "provider_signature", label: "Ordering Provider — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 82. Referral Form ------------------------------------------------------------------------------
async function referralForm() {
  return build((d) => {
    d.title("Patient Referral Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.heading("Referring Provider");
    d.fieldRow([
      { name: "referring_provider", label: "Referring Provider Name", width: 260 },
      { name: "referring_practice", label: "Practice", width: 220 },
    ]);
    d.heading("Referred To");
    d.fieldRow([
      { name: "specialist_name", label: "Specialist / Facility Name", width: 260 },
      { name: "specialty", label: "Specialty", width: 220 },
    ]);
    d.fieldRow([{ name: "reason_for_referral", label: "Reason for Referral", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "relevant_history", label: "Relevant Medical History / Findings", width: CONTENT_W, multiline: true }]);
    d.radioRow("urgency", "Urgency", ["Routine", "Urgent", "Emergency"]);
    d.fieldRow([{ name: "referring_provider_signature", label: "Referring Provider — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 83. Discharge Summary --------------------------------------------------------------------------
async function dischargeSummary() {
  return build((d) => {
    d.title("Patient Discharge Summary");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 220 },
      { name: "admission_date", label: "Admission Date", width: 140 },
      { name: "discharge_date", label: "Discharge Date", width: 120 },
    ]);
    d.fieldRow([{ name: "primary_diagnosis", label: "Primary Diagnosis", width: CONTENT_W }]);
    d.fieldRow([{ name: "treatment_summary", label: "Summary of Treatment Provided", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "discharge_medications", label: "Discharge Medications", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "follow_up_instructions", label: "Follow-Up Instructions", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "follow_up_provider", label: "Follow-Up Provider", width: 260 },
      { name: "follow_up_date", label: "Follow-Up Appointment Date", width: 220 },
    ]);
    d.fieldRow([{ name: "attending_provider_signature", label: "Attending Provider — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 84. Medical Billing Form -----------------------------------------------------------------------
async function medicalBillingForm() {
  return build((d) => {
    d.title("Medical Billing Statement");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "account_number", label: "Account Number", width: 220 },
    ]);
    d.fieldRow([
      { name: "service_date", label: "Date of Service", width: 180 },
      { name: "provider_name", label: "Provider", width: 240 },
    ]);
    d.heading("Charges");
    for (let i = 1; i <= 5; i++) {
      d.fieldRow([
        { name: `charge_${i}_description`, label: "Service / CPT Description", width: 280 },
        { name: `charge_${i}_amount`, label: "Amount ($)", width: 130 },
      ]);
    }
    d.fieldRow([
      { name: "insurance_paid", label: "Paid by Insurance ($)", width: 200 },
      { name: "amount_due", label: "Patient Amount Due ($)", width: 200 },
    ]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 85. Telehealth Consent --------------------------------------------------------------------------
async function telehealthConsent() {
  return build((d) => {
    d.title("Telehealth Consent Form");
    d.paragraph(
      "I consent to receive healthcare services from the provider named below via telehealth (audio and/or video), and understand this may include diagnosis, treatment recommendations, and prescriptions where appropriate.",
    );
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "provider_name", label: "Provider / Practice Name", width: CONTENT_W }]);
    d.checkboxRow("understands_limitations", "I understand telehealth has limitations compared to an in-person exam and may require an in-person follow-up");
    d.checkboxRow("understands_privacy", "I understand reasonable steps are taken to protect the privacy of this session, though no electronic transmission is fully secure");
    d.checkboxRow("understands_technical_issues", "I understand the session may be interrupted or discontinued due to technical issues");
    d.spacer(6);
    d.fieldRow([
      { name: "patient_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 86. Allergy Information Form ------------------------------------------------------------------
async function allergyInformationForm() {
  return build((d) => {
    d.title("Allergy Information Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.heading("Known Allergies");
    for (let i = 1; i <= 5; i++) {
      d.fieldRow([
        { name: `allergy_${i}_substance`, label: "Substance (medication, food, other)", width: 200 },
        { name: `allergy_${i}_reaction`, label: "Reaction", width: 180 },
        { name: `allergy_${i}_severity`, label: "Severity", width: 80 },
      ]);
    }
    d.checkboxRow("no_known_allergies", "Patient reports no known allergies");
    d.spacer(6);
    d.fieldRow([
      { name: "patient_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 87. Emergency Contact Form (medical) -------------------------------------------------------------
async function emergencyContactFormMedical() {
  return build((d) => {
    d.title("Emergency Contact Information Form");
    d.fieldRow([
      { name: "patient_name", label: "Patient Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.heading("Primary Emergency Contact");
    d.fieldRow([
      { name: "contact1_name", label: "Name", width: 190 },
      { name: "contact1_relationship", label: "Relationship", width: 140 },
      { name: "contact1_phone", label: "Phone", width: 130 },
    ]);
    d.heading("Secondary Emergency Contact");
    d.fieldRow([
      { name: "contact2_name", label: "Name", width: 190 },
      { name: "contact2_relationship", label: "Relationship", width: 140 },
      { name: "contact2_phone", label: "Phone", width: 130 },
    ]);
    d.heading("Additional Notes");
    d.fieldRow([{ name: "medical_notes", label: "Medical Conditions Responders Should Know About", width: CONTENT_W, multiline: true }]);
    d.disclaimer(MEDICAL_DISCLAIMER);
  });
}

// --- 88. Loan Application ---------------------------------------------------------------------------
async function loanApplication() {
  return build((d) => {
    d.title("Loan Application");
    d.heading("Applicant Information");
    d.fieldRow([
      { name: "applicant_name", label: "Full Legal Name", width: 260 },
      { name: "ssn_last4", label: "SSN (last 4 digits)", width: 120 },
      { name: "date_of_birth", label: "Date of Birth", width: 100 },
    ]);
    d.fieldRow([{ name: "address", label: "Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "phone", label: "Phone", width: 180 },
      { name: "email", label: "Email", width: 220 },
    ]);
    d.heading("Employment & Income");
    d.fieldRow([
      { name: "employer", label: "Employer", width: 260 },
      { name: "annual_income", label: "Annual Income ($)", width: 220 },
    ]);
    d.heading("Loan Requested");
    d.fieldRow([
      { name: "loan_amount", label: "Loan Amount Requested ($)", width: 220 },
      { name: "loan_purpose", label: "Purpose of Loan", width: 220 },
    ]);
    d.radioRow("loan_type", "Loan Type", ["Personal", "Auto", "Mortgage", "Business", "Other"]);
    d.fieldRow([{ name: "existing_debts", label: "Existing Debts / Monthly Obligations", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("authorizes_credit_check", "I authorize a credit check as part of this application");
    d.spacer(6);
    d.fieldRow([
      { name: "applicant_signature", label: "Applicant — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 89. Credit Authorization Form ------------------------------------------------------------------
async function creditAuthorizationForm() {
  return build((d) => {
    d.title("Credit Authorization Form");
    d.paragraph(
      "I authorize the party named below to obtain a copy of my credit report from one or more consumer reporting agencies for the purpose described below.",
    );
    d.fieldRow([
      { name: "applicant_name", label: "Full Legal Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "address", label: "Address", width: CONTENT_W }]);
    d.fieldRow([{ name: "requesting_party", label: "Party Requesting Authorization", width: CONTENT_W }]);
    d.fieldRow([{ name: "purpose", label: "Purpose of Credit Check", width: CONTENT_W }]);
    d.spacer(6);
    d.fieldRow([
      { name: "applicant_signature", label: "Applicant — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 90. Wire Transfer Form -------------------------------------------------------------------------
async function wireTransferForm() {
  return build((d) => {
    d.title("Wire Transfer Request Form");
    d.heading("Sender Information");
    d.fieldRow([
      { name: "sender_name", label: "Sender Name", width: 260 },
      { name: "sender_account", label: "Sender Account Number", width: 220 },
    ]);
    d.heading("Recipient Information");
    d.fieldRow([
      { name: "recipient_name", label: "Recipient Name", width: 260 },
      { name: "recipient_bank", label: "Recipient Bank", width: 220 },
    ]);
    d.fieldRow([
      { name: "recipient_account", label: "Recipient Account Number / IBAN", width: 260 },
      { name: "routing_swift", label: "Routing / SWIFT Code", width: 220 },
    ]);
    d.heading("Transfer Details");
    d.fieldRow([
      { name: "amount", label: "Amount", width: 180 },
      { name: "currency", label: "Currency", width: 120 },
      { name: "transfer_date", label: "Requested Date", width: 180 },
    ]);
    d.fieldRow([{ name: "memo", label: "Memo / Reference", width: CONTENT_W }]);
    d.checkboxRow("confirms_details", "I confirm the recipient details above are accurate and authorize this transfer");
    d.spacer(6);
    d.fieldRow([
      { name: "sender_signature", label: "Sender — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 91. Budget Template ----------------------------------------------------------------------------
async function budgetTemplate() {
  return build((d) => {
    d.title("Budget Template");
    d.fieldRow([
      { name: "budget_owner", label: "Prepared By", width: 260 },
      { name: "period", label: "Budget Period", width: 220 },
    ]);
    d.heading("Income");
    for (let i = 1; i <= 4; i++) {
      d.fieldRow([
        { name: `income_${i}_source`, label: "Source", width: 320 },
        { name: `income_${i}_amount`, label: "Amount ($)", width: 140 },
      ]);
    }
    d.heading("Expenses");
    for (let i = 1; i <= 8; i++) {
      d.fieldRow([
        { name: `expense_${i}_category`, label: "Category", width: 320 },
        { name: `expense_${i}_amount`, label: "Amount ($)", width: 140 },
      ]);
    }
    d.fieldRow([
      { name: "total_income", label: "Total Income ($)", width: 220 },
      { name: "total_expenses", label: "Total Expenses ($)", width: 220 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 92. Audit Checklist -----------------------------------------------------------------------------
async function auditChecklist() {
  return build((d) => {
    d.title("Internal Audit Checklist");
    d.fieldRow([
      { name: "audit_area", label: "Area / Department Audited", width: 260 },
      { name: "auditor_name", label: "Auditor", width: 220 },
    ]);
    d.fieldRow([{ name: "audit_date", label: "Audit Date", width: 200 }]);
    d.heading("Checklist Items");
    const items = [
      "Financial records are complete and reconciled",
      "Required approvals are documented for all transactions",
      "Segregation of duties is maintained",
      "Access controls are reviewed and up to date",
      "Policies and procedures are current and followed",
      "Prior audit findings have been remediated",
    ];
    for (const item of items) d.checkboxRow(item.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40), item);
    d.fieldRow([{ name: "findings", label: "Findings / Exceptions Noted", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "corrective_actions", label: "Recommended Corrective Actions", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "auditor_signature", label: "Auditor — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 93. Invoice Financing Form ----------------------------------------------------------------------
async function invoiceFinancingForm() {
  return build((d) => {
    d.title("Invoice Financing Application");
    d.paragraph("Use this form to request financing against an outstanding invoice owed to your business by a customer.");
    d.heading("Applicant (Business)");
    d.fieldRow([
      { name: "business_name", label: "Business Name", width: 260 },
      { name: "contact_name", label: "Contact Name", width: 220 },
    ]);
    d.heading("Invoice Details");
    d.fieldRow([
      { name: "invoice_number", label: "Invoice Number", width: 180 },
      { name: "invoice_amount", label: "Invoice Amount ($)", width: 180 },
      { name: "invoice_date", label: "Invoice Date", width: 120 },
    ]);
    d.fieldRow([
      { name: "customer_name", label: "Customer (Debtor) Name", width: 260 },
      { name: "due_date", label: "Payment Due Date", width: 220 },
    ]);
    d.fieldRow([
      { name: "amount_requested", label: "Financing Amount Requested ($)", width: 260 },
    ]);
    d.checkboxRow("invoice_not_pledged", "This invoice has not been pledged or financed elsewhere");
    d.spacer(6);
    d.fieldRow([
      { name: "applicant_signature", label: "Applicant — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 94. Compliance Certification --------------------------------------------------------------------
async function complianceCertification() {
  return build((d) => {
    d.title("Compliance Certification");
    d.paragraph(
      "I certify, on behalf of the organization named below, that the statements made in this certification are true and correct to the best of my knowledge as of the date signed.",
    );
    d.fieldRow([
      { name: "organization_name", label: "Organization Name", width: 260 },
      { name: "certifying_period", label: "Period Covered", width: 220 },
    ]);
    d.checkboxRow("policies_in_place", "Required policies and procedures are documented and in effect");
    d.checkboxRow("training_completed", "Required staff training has been completed");
    d.checkboxRow("no_known_violations", "No known material violations occurred during this period");
    d.fieldRow([{ name: "exceptions_noted", label: "Exceptions or Issues Noted (if any)", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([
      { name: "certifying_officer", label: "Certifying Officer — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 95. KYC (Know Your Customer) Form -----------------------------------------------------------------
async function kycForm() {
  return build((d) => {
    d.title("Know Your Customer (KYC) Form");
    d.heading("Identity Information");
    d.fieldRow([
      { name: "full_name", label: "Full Legal Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "address", label: "Residential Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "id_type", label: "ID Type (passport, license, etc.)", width: 260 },
      { name: "id_number", label: "ID Number", width: 220 },
    ]);
    d.heading("Purpose & Source of Funds");
    d.fieldRow([{ name: "account_purpose", label: "Purpose of Account / Relationship", width: CONTENT_W }]);
    d.fieldRow([{ name: "source_of_funds", label: "Source of Funds", width: CONTENT_W }]);
    d.checkboxRow("is_pep", "I am, or am closely associated with, a Politically Exposed Person (PEP)");
    d.spacer(6);
    d.fieldRow([
      { name: "customer_signature", label: "Customer — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 96. AML Questionnaire ---------------------------------------------------------------------------
async function amlQuestionnaire() {
  return build((d) => {
    d.title("Anti-Money Laundering (AML) Questionnaire");
    d.fieldRow([
      { name: "entity_name", label: "Individual / Entity Name", width: 260 },
      { name: "date", label: "Date", width: 200 },
    ]);
    d.checkboxRow("high_risk_jurisdiction", "Operates or has significant ties to a high-risk jurisdiction");
    d.checkboxRow("cash_intensive", "Business is cash-intensive");
    d.checkboxRow("third_party_funds", "Regularly receives funds on behalf of third parties");
    d.checkboxRow("prior_regulatory_action", "Has been subject to prior regulatory action related to AML compliance");
    d.fieldRow([{ name: "explanation", label: "Explanation for Any Items Checked Above", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "aml_program_description", label: "Description of AML Compliance Program (if applicable)", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([
      { name: "respondent_signature", label: "Respondent — Signature (type full name)", width: 300 },
      { name: "signature_date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 97. Vendor Payment Request ------------------------------------------------------------------------
async function vendorPaymentRequest() {
  return build((d) => {
    d.title("Vendor Payment Request");
    d.fieldRow([
      { name: "vendor_name", label: "Vendor Name", width: 260 },
      { name: "vendor_id", label: "Vendor ID (if applicable)", width: 220 },
    ]);
    d.fieldRow([
      { name: "invoice_number", label: "Invoice Number", width: 200 },
      { name: "invoice_date", label: "Invoice Date", width: 160 },
      { name: "amount", label: "Amount ($)", width: 120 },
    ]);
    d.fieldRow([{ name: "description", label: "Description of Goods/Services", width: CONTENT_W }]);
    d.fieldRow([
      { name: "requested_by", label: "Requested By", width: 260 },
      { name: "cost_center", label: "Cost Center / Department", width: 220 },
    ]);
    d.radioRow("payment_method", "Payment Method", ["ACH", "Wire", "Check", "Card"]);
    d.checkboxRow("approved_for_payment", "Approved for payment");
    d.spacer(6);
    d.signatureBlock("Requester", "Approver");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 98. Project Charter -----------------------------------------------------------------------------
async function projectCharter() {
  return build((d) => {
    d.title("Project Charter");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "project_sponsor", label: "Sponsor", width: 180 },
    ]);
    d.fieldRow([
      { name: "project_manager", label: "Project Manager", width: 260 },
      { name: "start_date", label: "Start Date", width: 220 },
    ]);
    d.fieldRow([{ name: "objective", label: "Project Objective", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "scope", label: "Scope (in / out of scope)", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "deliverables", label: "Key Deliverables", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "milestones", label: "Major Milestones and Target Dates", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "budget", label: "Approved Budget ($)", width: 220 },
      { name: "success_criteria", label: "Success Criteria", width: 220 },
    ]);
    d.spacer(6);
    d.signatureBlock("Sponsor", "Project Manager");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 99. Action Item Log -----------------------------------------------------------------------------
async function actionItemLog() {
  return build((d) => {
    d.title("Action Item Log");
    d.fieldRow([
      { name: "project_name", label: "Project / Meeting", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    for (let i = 1; i <= 8; i++) {
      d.fieldRow([
        { name: `item_${i}_description`, label: `Action Item ${i}`, width: 230 },
        { name: `item_${i}_owner`, label: "Owner", width: 120 },
        { name: `item_${i}_due`, label: "Due Date", width: 90 },
        { name: `item_${i}_status`, label: "Status", width: 40 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 100. Risk Register --------------------------------------------------------------------------------
async function riskRegister() {
  return build((d) => {
    d.title("Project Risk Register");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    for (let i = 1; i <= 6; i++) {
      d.fieldRow([
        { name: `risk_${i}_description`, label: `Risk ${i}`, width: 200 },
        { name: `risk_${i}_likelihood`, label: "Likelihood", width: 90 },
        { name: `risk_${i}_impact`, label: "Impact", width: 90 },
        { name: `risk_${i}_mitigation`, label: "Mitigation Plan", width: 100 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 101. Project Change Request ------------------------------------------------------------------------
async function projectChangeRequest() {
  return build((d) => {
    d.title("Project Change Request");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "request_date", label: "Request Date", width: 180 },
    ]);
    d.fieldRow([
      { name: "requested_by", label: "Requested By", width: 260 },
      { name: "priority", label: "Priority", width: 220 },
    ]);
    d.fieldRow([{ name: "change_description", label: "Description of Requested Change", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "justification", label: "Justification / Business Need", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "impact_scope_schedule_cost", label: "Impact on Scope, Schedule, and Cost", width: CONTENT_W, multiline: true }]);
    d.radioRow("decision", "Decision", ["Approved", "Rejected", "Deferred"]);
    d.spacer(6);
    d.signatureBlock("Requester", "Approver");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 102. Project Status Report --------------------------------------------------------------------------
async function projectStatusReport() {
  return build((d) => {
    d.title("Project Status Report");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "reporting_period", label: "Reporting Period", width: 180 },
    ]);
    d.radioRow("overall_status", "Overall Status", ["On track", "At risk", "Off track", "Complete"]);
    d.fieldRow([{ name: "accomplishments", label: "Accomplishments This Period", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "planned_next_period", label: "Planned for Next Period", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "blockers", label: "Blockers / Issues", width: CONTENT_W, multiline: true }]);
    d.fieldRow([
      { name: "budget_status", label: "Budget Status", width: 220 },
      { name: "schedule_status", label: "Schedule Status", width: 220 },
    ]);
    d.fieldRow([{ name: "prepared_by", label: "Prepared By", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 103. Issue Log -------------------------------------------------------------------------------------
async function issueLog() {
  return build((d) => {
    d.title("Project Issue Log");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    for (let i = 1; i <= 8; i++) {
      d.fieldRow([
        { name: `issue_${i}_description`, label: `Issue ${i}`, width: 220 },
        { name: `issue_${i}_owner`, label: "Owner", width: 120 },
        { name: `issue_${i}_priority`, label: "Priority", width: 80 },
        { name: `issue_${i}_status`, label: "Status", width: 60 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 104. Project Budget Tracker -------------------------------------------------------------------------
async function projectBudgetTracker() {
  return build((d) => {
    d.title("Project Budget Tracker");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "period", label: "Period", width: 180 },
    ]);
    d.fieldRow([
      { name: "total_budget", label: "Total Approved Budget ($)", width: 260 },
      { name: "spent_to_date", label: "Spent to Date ($)", width: 220 },
    ]);
    d.heading("Budget Line Items");
    for (let i = 1; i <= 6; i++) {
      d.fieldRow([
        { name: `line_${i}_category`, label: "Category", width: 240 },
        { name: `line_${i}_budgeted`, label: "Budgeted ($)", width: 130 },
        { name: `line_${i}_actual`, label: "Actual ($)", width: 106 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 105. Stakeholder Register ----------------------------------------------------------------------------
async function stakeholderRegister() {
  return build((d) => {
    d.title("Stakeholder Register");
    d.fieldRow([
      { name: "project_name", label: "Project Name", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    for (let i = 1; i <= 6; i++) {
      d.fieldRow([
        { name: `stakeholder_${i}_name`, label: `Stakeholder ${i}`, width: 180 },
        { name: `stakeholder_${i}_role`, label: "Role/Interest", width: 140 },
        { name: `stakeholder_${i}_influence`, label: "Influence", width: 80 },
        { name: `stakeholder_${i}_contact`, label: "Contact", width: 76 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 106. Operational Checklist ---------------------------------------------------------------------------
async function operationalChecklist() {
  return build((d) => {
    d.title("Operational Checklist");
    d.fieldRow([
      { name: "checklist_title", label: "Checklist Title", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    d.fieldRow([{ name: "completed_by", label: "Completed By", width: CONTENT_W }]);
    d.heading("Checklist Items");
    for (let i = 1; i <= 10; i++) {
      d.checkboxRow(`item_${i}`, `Item ${i}: __________________________________________`);
    }
    d.fieldRow([{ name: "notes", label: "Notes", width: CONTENT_W, multiline: true }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 107. Standard Operating Procedure (SOP) Template -------------------------------------------------------
async function sopTemplate() {
  return build((d) => {
    d.title("Standard Operating Procedure (SOP)");
    d.fieldRow([
      { name: "sop_title", label: "SOP Title", width: 300 },
      { name: "sop_number", label: "SOP Number", width: 180 },
    ]);
    d.fieldRow([
      { name: "effective_date", label: "Effective Date", width: 200 },
      { name: "owner", label: "Process Owner", width: 220 },
    ]);
    d.fieldRow([{ name: "purpose", label: "Purpose", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "scope", label: "Scope", width: CONTENT_W, multiline: true }]);
    d.heading("Procedure Steps");
    for (let i = 1; i <= 6; i++) {
      d.fieldRow([{ name: `step_${i}`, label: `Step ${i}`, width: CONTENT_W }]);
    }
    d.fieldRow([{ name: "safety_notes", label: "Safety / Compliance Notes", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "approved_by", label: "Approved By — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 108. Root Cause Analysis Report ---------------------------------------------------------------------------
async function rootCauseAnalysis() {
  return build((d) => {
    d.title("Root Cause Analysis Report");
    d.fieldRow([
      { name: "issue_title", label: "Issue / Incident Title", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    d.fieldRow([{ name: "problem_statement", label: "Problem Statement", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "timeline", label: "Timeline of Events", width: CONTENT_W, multiline: true }]);
    d.heading("Analysis (5 Whys or equivalent)");
    for (let i = 1; i <= 5; i++) {
      d.fieldRow([{ name: `why_${i}`, label: `Why ${i}`, width: CONTENT_W }]);
    }
    d.fieldRow([{ name: "root_cause", label: "Identified Root Cause", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "corrective_actions", label: "Corrective / Preventive Actions", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "prepared_by", label: "Prepared By — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 109. Meeting Minutes (General) -----------------------------------------------------------------------------
async function meetingMinutesGeneral() {
  return build((d) => {
    d.title("Meeting Minutes");
    d.fieldRow([
      { name: "meeting_title", label: "Meeting Title", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    d.fieldRow([
      { name: "location", label: "Location / Platform", width: 260 },
      { name: "facilitator", label: "Facilitator", width: 220 },
    ]);
    d.fieldRow([{ name: "attendees", label: "Attendees", width: CONTENT_W }]);
    d.heading("Agenda Items & Discussion");
    d.fieldRow([{ name: "discussion", label: "Discussion Summary", width: CONTENT_W, multiline: true }]);
    d.heading("Decisions Made");
    d.fieldRow([{ name: "decisions", label: "Decisions", width: CONTENT_W, multiline: true }]);
    d.heading("Action Items");
    for (let i = 1; i <= 4; i++) {
      d.fieldRow([
        { name: `action_${i}_description`, label: `Action Item ${i}`, width: 260 },
        { name: `action_${i}_owner`, label: "Owner", width: 130 },
        { name: `action_${i}_due`, label: "Due Date", width: 86 },
      ]);
    }
    d.fieldRow([{ name: "next_meeting_date", label: "Next Meeting Date", width: 220 }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 110. General Consent Form ------------------------------------------------------------------------------
async function generalConsentForm() {
  return build((d) => {
    d.title("General Consent Form");
    d.paragraph(
      "I, the undersigned, voluntarily consent to participate in the activity or service described below, and acknowledge that I have had the opportunity to ask questions before signing.",
    );
    d.fieldRow([
      { name: "participant_name", label: "Participant Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "activity_description", label: "Description of Activity / Service", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "organization_name", label: "Organization Name", width: CONTENT_W }]);
    d.checkboxRow("understands_risks", "I understand the risks involved and consent to participate");
    d.fieldRow([{ name: "guardian_relationship", label: "Signing as Parent/Guardian — Relationship (if applicable)", width: CONTENT_W }]);
    d.spacer(6);
    d.fieldRow([
      { name: "signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 111. Event Registration Form ---------------------------------------------------------------------------
async function eventRegistrationForm() {
  return build((d) => {
    d.title("Event Registration Form");
    d.fieldRow([
      { name: "event_name", label: "Event Name", width: 300 },
      { name: "event_date", label: "Event Date", width: 180 },
    ]);
    d.fieldRow([
      { name: "attendee_name", label: "Attendee Full Name", width: 260 },
      { name: "email", label: "Email", width: 220 },
    ]);
    d.fieldRow([
      { name: "phone", label: "Phone", width: 200 },
      { name: "organization", label: "Organization (if applicable)", width: 220 },
    ]);
    d.dropdownRow("ticket_type", "Ticket Type", ["General Admission", "VIP", "Student", "Group"], { width: 240 });
    d.checkboxRow("dietary_restrictions", "I have dietary restrictions (describe below)");
    d.fieldRow([{ name: "dietary_details", label: "Dietary Details / Accommodations", width: CONTENT_W }]);
    d.fieldRow([{ name: "emergency_contact", label: "Emergency Contact (name and phone)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 112. Complaint Form -----------------------------------------------------------------------------------
async function complaintForm() {
  return build((d) => {
    d.title("Complaint Form");
    d.fieldRow([
      { name: "complainant_name", label: "Full Name", width: 260 },
      { name: "date", label: "Date", width: 200 },
    ]);
    d.fieldRow([
      { name: "contact_phone", label: "Phone", width: 200 },
      { name: "contact_email", label: "Email", width: 220 },
    ]);
    d.fieldRow([{ name: "complaint_against", label: "Complaint Regarding (person, department, or service)", width: CONTENT_W }]);
    d.fieldRow([{ name: "incident_date", label: "Date of Incident", width: 200 }]);
    d.fieldRow([{ name: "complaint_description", label: "Description of Complaint", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "desired_resolution", label: "Desired Resolution", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "signature", label: "Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 113. Survey Form --------------------------------------------------------------------------------------
async function surveyForm() {
  return build((d) => {
    d.title("Survey Form");
    d.fieldRow([
      { name: "survey_title", label: "Survey Title", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    for (let i = 1; i <= 5; i++) {
      d.fieldRow([{ name: `question_${i}`, label: `Question ${i}`, width: CONTENT_W }]);
      d.radioRow(`answer_${i}`, "Response", ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"]);
    }
    d.fieldRow([{ name: "additional_comments", label: "Additional Comments", width: CONTENT_W, multiline: true }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 114. Membership Application ----------------------------------------------------------------------------
async function membershipApplication() {
  return build((d) => {
    d.title("Membership Application");
    d.fieldRow([
      { name: "applicant_name", label: "Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "address", label: "Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "phone", label: "Phone", width: 200 },
      { name: "email", label: "Email", width: 220 },
    ]);
    d.dropdownRow("membership_type", "Membership Type", ["Individual", "Family", "Student", "Senior", "Corporate"], { width: 240 });
    d.fieldRow([{ name: "referred_by", label: "Referred By (optional)", width: CONTENT_W }]);
    d.checkboxRow("agrees_to_terms", "I agree to abide by the organization's bylaws and code of conduct");
    d.spacer(6);
    d.fieldRow([
      { name: "applicant_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 115. Donation Form -----------------------------------------------------------------------------------
async function donationForm() {
  return build((d) => {
    d.title("Donation Form");
    d.fieldRow([
      { name: "donor_name", label: "Donor Full Name", width: 260 },
      { name: "date", label: "Date", width: 200 },
    ]);
    d.fieldRow([{ name: "address", label: "Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "donation_amount", label: "Donation Amount ($)", width: 220 },
      { name: "payment_method", label: "Payment Method", width: 220 },
    ]);
    d.radioRow("donation_type", "Type", ["One-time", "Monthly recurring", "In-kind"]);
    d.checkboxRow("anonymous", "I wish to remain anonymous");
    d.checkboxRow("tax_receipt_requested", "I would like a tax-deductible receipt");
    d.fieldRow([{ name: "designation", label: "Designation (fund or program, if any)", width: CONTENT_W }]);
    d.spacer(6);
    d.fieldRow([{ name: "donor_signature", label: "Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 116. Volunteer Application ----------------------------------------------------------------------------
async function volunteerApplication() {
  return build((d) => {
    d.title("Volunteer Application");
    d.fieldRow([
      { name: "applicant_name", label: "Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([
      { name: "phone", label: "Phone", width: 200 },
      { name: "email", label: "Email", width: 220 },
    ]);
    d.fieldRow([{ name: "availability", label: "Availability (days/times)", width: CONTENT_W }]);
    d.fieldRow([{ name: "areas_of_interest", label: "Areas of Interest", width: CONTENT_W }]);
    d.fieldRow([{ name: "relevant_experience", label: "Relevant Skills or Experience", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "emergency_contact", label: "Emergency Contact (name and phone)", width: CONTENT_W }]);
    d.checkboxRow("background_check_consent", "I consent to a background check if required for this role");
    d.spacer(6);
    d.fieldRow([
      { name: "applicant_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 117. Gift Certificate -----------------------------------------------------------------------------------
async function giftCertificate() {
  return build((d) => {
    d.title("Gift Certificate");
    d.fieldRow([
      { name: "business_name", label: "Business / Issuer Name", width: 300 },
      { name: "certificate_number", label: "Certificate Number", width: 180 },
    ]);
    d.fieldRow([
      { name: "recipient_name", label: "Recipient Name", width: 260 },
      { name: "amount_or_service", label: "Value / Service Described", width: 220 },
    ]);
    d.fieldRow([
      { name: "issue_date", label: "Issue Date", width: 200 },
      { name: "expiration_date", label: "Expiration Date (if any)", width: 220 },
    ]);
    d.fieldRow([{ name: "terms", label: "Terms of Redemption", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "issuer_signature", label: "Issued By — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 118. Personal Budget -----------------------------------------------------------------------------------
async function personalBudget() {
  return build((d) => {
    d.title("Personal Budget");
    d.fieldRow([
      { name: "name", label: "Name", width: 300 },
      { name: "month", label: "Month / Period", width: 180 },
    ]);
    d.heading("Monthly Income");
    d.fieldRow([{ name: "monthly_income", label: "Total Monthly Income ($)", width: 260 }]);
    d.heading("Monthly Expenses");
    const categories = ["Housing", "Utilities", "Groceries", "Transportation", "Insurance", "Debt Payments", "Savings", "Entertainment"];
    for (const cat of categories) {
      d.fieldRow([
        { name: `expense_${cat.toLowerCase().replace(/\s+/g, "_")}`, label: cat, width: 340 },
        { name: `expense_${cat.toLowerCase().replace(/\s+/g, "_")}_amount`, label: "Amount ($)", width: 120 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 119. Household Inventory --------------------------------------------------------------------------------
async function householdInventory() {
  return build((d) => {
    d.title("Household Inventory");
    d.paragraph("A record of household belongings and their approximate value — useful for insurance claims or estate planning.");
    d.fieldRow([
      { name: "property_address", label: "Property Address", width: 320 },
      { name: "date", label: "Date", width: 160 },
    ]);
    for (let i = 1; i <= 10; i++) {
      d.fieldRow([
        { name: `item_${i}_description`, label: "Item", width: 190 },
        { name: `item_${i}_room`, label: "Room", width: 90 },
        { name: `item_${i}_value`, label: "Value ($)", width: 90 },
        { name: `item_${i}_serial`, label: "Serial # (if any)", width: 106 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 120. Emergency Plan -----------------------------------------------------------------------------------
async function emergencyPlan() {
  return build((d) => {
    d.title("Household Emergency Plan");
    d.fieldRow([
      { name: "household_name", label: "Household Name", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    d.heading("Emergency Contacts");
    d.fieldRow([
      { name: "contact1_name", label: "Contact 1 — Name", width: 190 },
      { name: "contact1_phone", label: "Phone", width: 150 },
      { name: "contact1_relationship", label: "Relationship", width: 120 },
    ]);
    d.fieldRow([
      { name: "contact2_name", label: "Contact 2 — Name", width: 190 },
      { name: "contact2_phone", label: "Phone", width: 150 },
      { name: "contact2_relationship", label: "Relationship", width: 120 },
    ]);
    d.heading("Meeting Points");
    d.fieldRow([
      { name: "meeting_point_local", label: "Local Meeting Point", width: 260 },
      { name: "meeting_point_regional", label: "Out-of-Area Meeting Point", width: 220 },
    ]);
    d.heading("Important Information");
    d.fieldRow([{ name: "medical_needs", label: "Medical Needs / Medications to Bring", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "important_documents_location", label: "Location of Important Documents", width: CONTENT_W }]);
    d.fieldRow([{ name: "utility_shutoff_notes", label: "Utility Shutoff Locations / Notes", width: CONTENT_W, multiline: true }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 121. Travel Consent for Minors --------------------------------------------------------------------------
async function travelConsentForMinors() {
  return build((d) => {
    d.title("Minor Travel Consent Form");
    d.paragraph(
      "I, the undersigned parent/legal guardian, give permission for the minor named below to travel as described, accompanied by the adult(s) named below.",
    );
    d.fieldRow([
      { name: "minor_name", label: "Minor's Full Name", width: 260 },
      { name: "minor_date_of_birth", label: "Minor's Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "traveling_with", label: "Traveling With (name(s) of accompanying adult(s))", width: CONTENT_W }]);
    d.fieldRow([
      { name: "destination", label: "Destination", width: 260 },
      { name: "travel_dates", label: "Travel Dates", width: 220 },
    ]);
    d.fieldRow([{ name: "transportation_mode", label: "Mode of Transportation", width: CONTENT_W }]);
    d.heading("Parent/Guardian Information");
    d.fieldRow([
      { name: "guardian_name", label: "Parent/Guardian Full Name", width: 260 },
      { name: "guardian_phone", label: "Phone", width: 220 },
    ]);
    d.fieldRow([{ name: "emergency_medical_info", label: "Emergency Medical Information / Allergies", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([
      { name: "guardian_signature", label: "Parent/Guardian — Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 122. Assignment Cover Sheet -----------------------------------------------------------------
async function assignmentCoverSheet() {
  return build((d) => {
    d.title("Assignment Cover Sheet");
    d.fieldRow([
      { name: "student_name", label: "Student Name", width: 220 },
      { name: "student_id", label: "Student ID", width: 140 },
      { name: "date_submitted", label: "Date Submitted", width: 120 },
    ]);
    d.fieldRow([
      { name: "course_name", label: "Course Name / Number", width: 260 },
      { name: "instructor", label: "Instructor", width: 220 },
    ]);
    d.fieldRow([{ name: "assignment_title", label: "Assignment Title", width: CONTENT_W }]);
    d.fieldRow([{ name: "due_date", label: "Due Date", width: 220 }]);
    d.checkboxRow("academic_integrity", "I certify this work is my own and follows the academic integrity policy");
    d.checkboxRow("late_submission", "This is a late submission (see course policy)");
    d.spacer(6);
    d.fieldRow([{ name: "student_signature", label: "Student — Signature (type full name)", width: CONTENT_W }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 123. Grade Report --------------------------------------------------------------------------------
async function gradeReport() {
  return build((d) => {
    d.title("Grade Report");
    d.fieldRow([
      { name: "student_name", label: "Student Name", width: 220 },
      { name: "student_id", label: "Student ID", width: 140 },
      { name: "term", label: "Term", width: 120 },
    ]);
    d.heading("Courses");
    for (let i = 1; i <= 6; i++) {
      d.fieldRow([
        { name: `course_${i}_name`, label: "Course", width: 220 },
        { name: `course_${i}_credits`, label: "Credits", width: 90 },
        { name: `course_${i}_grade`, label: "Grade", width: 90 },
      ]);
    }
    d.fieldRow([
      { name: "gpa", label: "Term GPA", width: 160 },
      { name: "cumulative_gpa", label: "Cumulative GPA", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 124. Training Certificate --------------------------------------------------------------------------
async function trainingCertificate() {
  return build((d) => {
    d.title("Certificate of Completion");
    d.paragraph("This certifies that the individual named below has successfully completed the training program described here.");
    d.fieldRow([{ name: "recipient_name", label: "Recipient Full Name", width: CONTENT_W }]);
    d.fieldRow([{ name: "program_title", label: "Training Program / Course Title", width: CONTENT_W }]);
    d.fieldRow([
      { name: "completion_date", label: "Completion Date", width: 220 },
      { name: "hours_completed", label: "Hours Completed", width: 220 },
    ]);
    d.fieldRow([
      { name: "issuing_organization", label: "Issuing Organization", width: 260 },
      { name: "instructor_name", label: "Instructor / Facilitator", width: 220 },
    ]);
    d.spacer(10);
    d.signatureBlock("Instructor", "Program Director");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 125. Class Attendance Sheet -------------------------------------------------------------------------
async function classAttendanceSheet() {
  return build((d) => {
    d.title("Class Attendance Sheet");
    d.fieldRow([
      { name: "course_name", label: "Course Name", width: 260 },
      { name: "session_date", label: "Date", width: 220 },
    ]);
    d.fieldRow([{ name: "instructor", label: "Instructor", width: CONTENT_W }]);
    d.heading("Students");
    for (let i = 1; i <= 10; i++) {
      d.fieldRow([
        { name: `student_${i}_name`, label: `Student ${i}`, width: 260 },
        { name: `student_${i}_present`, label: "Present?", width: 100 },
        { name: `student_${i}_notes`, label: "Notes", width: 100 },
      ]);
    }
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 126. Student Feedback Form ------------------------------------------------------------------------
async function studentFeedbackForm() {
  return build((d) => {
    d.title("Student Feedback Form");
    d.fieldRow([
      { name: "course_name", label: "Course Name", width: 260 },
      { name: "instructor", label: "Instructor", width: 220 },
    ]);
    d.radioRow("overall_rating", "Overall Rating", ["Poor", "Fair", "Good", "Very Good", "Excellent"]);
    d.radioRow("pace_rating", "Pace of Instruction", ["Too Slow", "Just Right", "Too Fast"]);
    d.fieldRow([{ name: "what_worked", label: "What Worked Well", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "what_to_improve", label: "What Could Be Improved", width: CONTENT_W, multiline: true }]);
    d.checkboxRow("would_recommend", "I would recommend this course to others");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 127. Training Evaluation ------------------------------------------------------------------------------
async function trainingEvaluation() {
  return build((d) => {
    d.title("Training Evaluation Form");
    d.fieldRow([
      { name: "training_title", label: "Training Title", width: 300 },
      { name: "date", label: "Date", width: 180 },
    ]);
    d.fieldRow([{ name: "trainer_name", label: "Trainer / Facilitator", width: CONTENT_W }]);
    d.radioRow("content_rating", "Content Quality", ["1", "2", "3", "4", "5"]);
    d.radioRow("trainer_rating", "Trainer Effectiveness", ["1", "2", "3", "4", "5"]);
    d.radioRow("materials_rating", "Materials & Resources", ["1", "2", "3", "4", "5"]);
    d.fieldRow([{ name: "key_takeaways", label: "Key Takeaways", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "suggestions", label: "Suggestions for Improvement", width: CONTENT_W, multiline: true }]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 128. Scholarship Application ------------------------------------------------------------------------
async function scholarshipApplication() {
  return build((d) => {
    d.title("Scholarship Application");
    d.fieldRow([
      { name: "applicant_name", label: "Full Name", width: 260 },
      { name: "date_of_birth", label: "Date of Birth", width: 200 },
    ]);
    d.fieldRow([{ name: "address", label: "Address", width: CONTENT_W }]);
    d.fieldRow([
      { name: "school_name", label: "School / Institution", width: 260 },
      { name: "expected_graduation", label: "Expected Graduation", width: 220 },
    ]);
    d.fieldRow([
      { name: "gpa", label: "GPA", width: 140 },
      { name: "major_field", label: "Major / Field of Study", width: 300 },
    ]);
    d.fieldRow([{ name: "scholarship_name", label: "Scholarship Applying For", width: CONTENT_W }]);
    d.fieldRow([{ name: "essay_statement", label: "Personal Statement (why you deserve this scholarship)", width: CONTENT_W, multiline: true }]);
    d.fieldRow([{ name: "financial_need", label: "Financial Need Summary (if applicable)", width: CONTENT_W, multiline: true }]);
    d.spacer(6);
    d.fieldRow([
      { name: "applicant_signature", label: "Signature (type full name)", width: 300 },
      { name: "date", label: "Date", width: 160 },
    ]);
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

// --- 129. Internship Agreement ------------------------------------------------------------------------------
async function internshipAgreement() {
  return build((d) => {
    d.title("Internship Agreement");
    d.paragraph("This Agreement sets the terms of an internship between the Host Organization and the Intern identified below.");
    d.fieldRow([
      { name: "intern_name", label: "Intern Full Name", width: 260 },
      { name: "school_name", label: "School / Institution", width: 220 },
    ]);
    d.fieldRow([{ name: "host_organization", label: "Host Organization", width: CONTENT_W }]);
    d.fieldRow([
      { name: "start_date", label: "Start Date", width: 160 },
      { name: "end_date", label: "End Date", width: 160 },
      { name: "hours_per_week", label: "Hours/Week", width: 130 },
    ]);
    d.fieldRow([{ name: "supervisor_name", label: "Supervisor", width: CONTENT_W }]);
    d.fieldRow([{ name: "responsibilities", label: "Intern Responsibilities", width: CONTENT_W, multiline: true }]);
    d.radioRow("compensation_type", "Compensation", ["Unpaid", "Paid", "Academic credit"]);
    d.checkboxRow("confidentiality_required", "Intern agrees to maintain confidentiality of the organization's information");
    d.spacer(6);
    d.signatureBlock("Host Organization", "Intern");
    d.disclaimer(GENERIC_DISCLAIMER);
  });
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const templates = [
    { file: "mutual-nda.pdf", make: mutualNda },
    { file: "simple-invoice.pdf", make: simpleInvoice },
    { file: "residential-lease.pdf", make: residentialLease },
    { file: "general-release.pdf", make: generalRelease },
    { file: "contractor-tax-info.pdf", make: contractorTaxInfo },
    { file: "power-of-attorney.pdf", make: powerOfAttorney },
    { file: "last-will-testament.pdf", make: lastWillTestament },
    { file: "bill-of-sale.pdf", make: billOfSale },
    { file: "promissory-note.pdf", make: promissoryNote },
    { file: "non-compete-agreement.pdf", make: nonCompeteAgreement },
    { file: "employment-offer-letter.pdf", make: employmentOfferLetter },
    { file: "master-service-agreement.pdf", make: masterServiceAgreement },
    { file: "liability-waiver.pdf", make: liabilityWaiver },
    { file: "billing-statement.pdf", make: billingStatement },
    { file: "purchase-order.pdf", make: purchaseOrder },
    { file: "commercial-lease.pdf", make: commercialLease },
    { file: "property-disclosure.pdf", make: propertyDisclosure },
    { file: "job-application-form.pdf", make: jobApplicationForm },
    { file: "performance-evaluation.pdf", make: performanceEvaluation },
    { file: "patient-intake-form.pdf", make: patientIntakeForm },
    { file: "hipaa-acknowledgment.pdf", make: hipaaAcknowledgment },
    { file: "bill-of-lading.pdf", make: billOfLading },
    { file: "packing-slip.pdf", make: packingSlip },
    { file: "work-order-signoff.pdf", make: workOrderSignOff },
    { file: "safety-incident-report.pdf", make: safetyIncidentReport },
    { file: "board-meeting-minutes.pdf", make: boardMeetingMinutes },
    { file: "stock-purchase-agreement.pdf", make: stockPurchaseAgreement },
    { file: "insurance-claim-intake.pdf", make: insuranceClaimIntake },
    { file: "proof-of-loss.pdf", make: proofOfLoss },
    { file: "vendor-registration-form.pdf", make: vendorRegistrationForm },
    { file: "subcontractor-agreement.pdf", make: subcontractorAgreement },
    { file: "rental-application.pdf", make: rentalApplication },
    { file: "move-in-move-out-checklist.pdf", make: moveInMoveOutChecklist },
    { file: "tenant-ledger.pdf", make: tenantLedger },
    { file: "maintenance-request.pdf", make: maintenanceRequest },
    { file: "pet-addendum.pdf", make: petAddendum },
    { file: "eviction-notice.pdf", make: evictionNotice },
    { file: "rent-increase-notice.pdf", make: rentIncreaseNotice },
    { file: "security-deposit-return.pdf", make: securityDepositReturn },
    { file: "lease-renewal.pdf", make: leaseRenewal },
    { file: "property-inspection-report.pdf", make: propertyInspectionReport },
    { file: "hoa-violation-notice.pdf", make: hoaViolationNotice },
    { file: "roommate-agreement.pdf", make: roommateAgreement },
    { file: "short-term-rental-agreement.pdf", make: shortTermRentalAgreement },
    { file: "rent-receipt.pdf", make: rentReceipt },
    { file: "quote-estimate.pdf", make: quoteEstimate },
    { file: "receipt.pdf", make: genericReceipt },
    { file: "timesheet.pdf", make: timesheet },
    { file: "expense-report.pdf", make: expenseReport },
    { file: "reference-letter.pdf", make: referenceLetter },
    { file: "resignation-letter.pdf", make: resignationLetter },
    { file: "meeting-agenda.pdf", make: meetingAgenda },
    { file: "budget-request-form.pdf", make: budgetRequestForm },
    { file: "internal-memo.pdf", make: internalMemo },
    { file: "change-order-form.pdf", make: changeOrderForm },
    { file: "independent-contractor-agreement.pdf", make: independentContractorAgreement },
    { file: "purchase-agreement.pdf", make: purchaseAgreement },
    { file: "partnership-agreement.pdf", make: partnershipAgreement },
    { file: "operating-agreement-llc.pdf", make: operatingAgreementLLC },
    { file: "employment-contract.pdf", make: employmentContract },
    { file: "affidavit.pdf", make: affidavit },
    { file: "cease-and-desist-letter.pdf", make: ceaseAndDesistLetter },
    { file: "demand-letter.pdf", make: demandLetter },
    { file: "settlement-agreement.pdf", make: settlementAgreement },
    { file: "notary-acknowledgment.pdf", make: notaryAcknowledgment },
    { file: "contract-addendum.pdf", make: contractAddendum },
    { file: "employee-tax-withholding.pdf", make: employeeTaxWithholdingForm },
    { file: "employee-handbook-acknowledgment.pdf", make: employeeHandbookAcknowledgment },
    { file: "termination-notice.pdf", make: terminationNotice },
    { file: "background-check-authorization.pdf", make: backgroundCheckAuthorization },
    { file: "training-attendance-sheet.pdf", make: trainingAttendanceSheet },
    { file: "disciplinary-action-form.pdf", make: disciplinaryActionForm },
    { file: "promotion-request-form.pdf", make: promotionRequestForm },
    { file: "exit-interview-form.pdf", make: exitInterviewForm },
    { file: "remote-work-agreement.pdf", make: remoteWorkAgreement },
    { file: "medical-history-form.pdf", make: medicalHistoryForm },
    { file: "insurance-information-form.pdf", make: insuranceInformationForm },
    { file: "consent-for-treatment.pdf", make: consentForTreatment },
    { file: "prescription-request-form.pdf", make: prescriptionRequestForm },
    { file: "vaccination-record.pdf", make: vaccinationRecord },
    { file: "lab-requisition-form.pdf", make: labRequisitionForm },
    { file: "referral-form.pdf", make: referralForm },
    { file: "discharge-summary.pdf", make: dischargeSummary },
    { file: "medical-billing-form.pdf", make: medicalBillingForm },
    { file: "telehealth-consent.pdf", make: telehealthConsent },
    { file: "allergy-information-form.pdf", make: allergyInformationForm },
    { file: "emergency-contact-form.pdf", make: emergencyContactFormMedical },
    { file: "loan-application.pdf", make: loanApplication },
    { file: "credit-authorization.pdf", make: creditAuthorizationForm },
    { file: "wire-transfer-form.pdf", make: wireTransferForm },
    { file: "budget-template.pdf", make: budgetTemplate },
    { file: "audit-checklist.pdf", make: auditChecklist },
    { file: "invoice-financing-form.pdf", make: invoiceFinancingForm },
    { file: "compliance-certification.pdf", make: complianceCertification },
    { file: "kyc-form.pdf", make: kycForm },
    { file: "aml-questionnaire.pdf", make: amlQuestionnaire },
    { file: "vendor-payment-request.pdf", make: vendorPaymentRequest },
    { file: "project-charter.pdf", make: projectCharter },
    { file: "action-item-log.pdf", make: actionItemLog },
    { file: "risk-register.pdf", make: riskRegister },
    { file: "project-change-request.pdf", make: projectChangeRequest },
    { file: "project-status-report.pdf", make: projectStatusReport },
    { file: "issue-log.pdf", make: issueLog },
    { file: "project-budget-tracker.pdf", make: projectBudgetTracker },
    { file: "stakeholder-register.pdf", make: stakeholderRegister },
    { file: "operational-checklist.pdf", make: operationalChecklist },
    { file: "sop-template.pdf", make: sopTemplate },
    { file: "root-cause-analysis.pdf", make: rootCauseAnalysis },
    { file: "meeting-minutes.pdf", make: meetingMinutesGeneral },
    { file: "general-consent-form.pdf", make: generalConsentForm },
    { file: "event-registration-form.pdf", make: eventRegistrationForm },
    { file: "complaint-form.pdf", make: complaintForm },
    { file: "survey-form.pdf", make: surveyForm },
    { file: "membership-application.pdf", make: membershipApplication },
    { file: "donation-form.pdf", make: donationForm },
    { file: "volunteer-application.pdf", make: volunteerApplication },
    { file: "gift-certificate.pdf", make: giftCertificate },
    { file: "personal-budget.pdf", make: personalBudget },
    { file: "household-inventory.pdf", make: householdInventory },
    { file: "emergency-plan.pdf", make: emergencyPlan },
    { file: "travel-consent-for-minors.pdf", make: travelConsentForMinors },
    { file: "assignment-cover-sheet.pdf", make: assignmentCoverSheet },
    { file: "grade-report.pdf", make: gradeReport },
    { file: "training-certificate.pdf", make: trainingCertificate },
    { file: "class-attendance-sheet.pdf", make: classAttendanceSheet },
    { file: "student-feedback-form.pdf", make: studentFeedbackForm },
    { file: "training-evaluation.pdf", make: trainingEvaluation },
    { file: "scholarship-application.pdf", make: scholarshipApplication },
    { file: "internship-agreement.pdf", make: internshipAgreement },
  ];
  for (const t of templates) {
    const bytes = await t.make();
    await writeFile(path.join(OUT_DIR, t.file), bytes);
    console.log(`wrote ${t.file} (${bytes.length} bytes)`);
  }
}

main();
