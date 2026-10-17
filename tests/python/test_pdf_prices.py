"""Run: python -m unittest discover -s tests/python"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "extraction"))
from pdf_prices import loose_key, norm_key, parse_price  # noqa: E402


class ParsePrice(unittest.TestCase):
    def test_valid_formats(self):
        self.assertEqual(parse_price("SAR 1,250"), (1250, None))
        self.assertEqual(parse_price("SAR 1250"), (1250, None))
        self.assertEqual(parse_price("SAR 1,250.50"), (1250.5, None))
        self.assertEqual(parse_price("SAR 330"), (330, None))

    def test_rejects_ambiguous_or_invalid(self):
        self.assertEqual(parse_price("SAR 0")[1], "PRICE_NOT_POSITIVE")
        self.assertEqual(parse_price("")[1], "PRICE_EMPTY")
        self.assertEqual(parse_price("1.250,00")[1], "PRICE_FORMAT_UNRECOGNISED")  # no currency, European format
        self.assertEqual(parse_price("SAR 495 SAR 297")[1], "MULTIPLE_PRICES_IN_CELL")
        self.assertEqual(parse_price("l l c o l o rS A> R S 1o, u1 5n 8d")[1], "PRICE_FORMAT_UNRECOGNISED")


class Keys(unittest.TestCase):
    def test_norm_key_keeps_punctuation(self):
        self.assertEqual(norm_key(" dh-hac-hfw1519smn-il-a\n-pro "), "DH-HAC-HFW1519SMN-IL-A-PRO")
        self.assertEqual(norm_key("DHI–VTH"), "DHI-VTH")
        self.assertNotEqual(norm_key("IPC-HFW2441S-S"), norm_key("IPC-HFW2441S-S2"))

    def test_loose_key_only_drops_separators(self):
        self.assertEqual(loose_key("DH-IPC/HFW.2441"), "DHIPCHFW2441")


class FullRun(unittest.TestCase):
    """Regression check on the supplied PDFs, if present."""

    def test_counts_match_declared(self):
        import pymupdf  # noqa: F401
        from pdf_prices import extract_pdf

        pdfs = sorted((Path(__file__).resolve().parents[2] / "data" / "pdf_sources").glob("*NJOY*.pdf"))
        if not pdfs:
            self.skipTest("sample PDF not present")
        rows, meta = extract_pdf(pdfs[0], [])
        self.assertEqual(meta["extracted_rows"], meta["declared_products"])
        self.assertEqual([r["price_sar"] for r in rows][:3], [1726, 2707, 3100])
        self.assertTrue(all(r["price_source"].startswith("styled-span") for r in rows))


if __name__ == "__main__":
    unittest.main()
