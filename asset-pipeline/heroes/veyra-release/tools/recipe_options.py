"""Explicit, isolated output for the canonical Blender 4.3 Veyra recipe."""
import argparse
import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]
REPO = SOURCE_ROOT.parents[2]


def parse_options(argv=None, *, retarget=False):
  if argv is None:
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('--output-dir', type=Path)
  if retarget:
    parser.add_argument('--death-contact', action='store_true')
  args = parser.parse_args(argv)
  root = SOURCE_ROOT
  if args.output_dir is not None:
    root = (REPO / args.output_dir).resolve()
    # Keep the explicit trial away from shipped inputs, baseline and locks.
    if not root.is_relative_to(REPO / 'outputs') or root == REPO / 'outputs':
      parser.error('--output-dir must name a child of the repository outputs/ directory')
  if getattr(args, 'death_contact', False) and args.output_dir is None:
    parser.error('--death-contact requires --output-dir; runtime adoption is separate')
  return root, getattr(args, 'death_contact', False)
