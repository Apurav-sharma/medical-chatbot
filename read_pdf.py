import sys
sys.stdout.reconfigure(encoding='utf-8')
from pdfminer.high_level import extract_text
text = extract_text('SwasthiQ-Hiring-Assignment-September2026.pdf')
print(text)
