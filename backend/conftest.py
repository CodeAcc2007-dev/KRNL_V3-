import sys
from pathlib import Path

# Add backend directory to Python path so imports like 'from app.utils...' work
sys.path.insert(0, str(Path(__file__).parent))
