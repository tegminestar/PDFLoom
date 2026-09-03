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
      { name: "city", label: "City", width: 200 },
      { name: "state", label: "State / Province", width: 160 },
      { name: "zip", label: "ZIP / Postal Code", width: 140 },
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
      { name: "testator_name", label: "Testator (Full Legal Name)", width: 300 },
      { name: "testator_address", label: "Address", width: 220 },
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
      { name: "restricted_period", label: "Restricted Period (e.g. 12 months after termination)", width: 300 },
      { name: "restricted_territory", label: "Restricted Territory", width: 220 },
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
  ];
  for (const t of templates) {
    const bytes = await t.make();
    await writeFile(path.join(OUT_DIR, t.file), bytes);
    console.log(`wrote ${t.file} (${bytes.length} bytes)`);
  }
}

main();
