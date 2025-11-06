#!/usr/bin/env python3
"""Add modern-style.css and styleToggle.js to all HTML files"""
import os
import re

root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))

def get_relative_path(filepath):
    """Determine the relative path prefix based on file location"""
    rel_path = os.path.relpath(filepath, root_dir)
    depth = rel_path.count(os.sep)
    if depth == 0:
        return 'assets/'
    else:
        return '../' * depth + 'assets/'

def add_modern_style_support(filepath):
    """Add modern-style.css and styleToggle.js to an HTML file"""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    original_content = content
    assets_prefix = get_relative_path(filepath)
    
    # Add CSS link if not already present
    if 'modern-style.css' not in content:
        # Pattern for style.css with various possible path prefixes
        css_pattern = re.compile(r'(<link rel="stylesheet" href="(?:\.\./)*assets/css/style\.css">)')
        if css_pattern.search(content):
            content = css_pattern.sub(lambda m: f'{m.group(1)}\n  <link rel="stylesheet" href="{assets_prefix}css/modern-style.css">', content, count=1)
        elif '<link rel="stylesheet"' in content and '</head>' in content:
            # Add before </head> if no style.css reference
            content = content.replace('</head>', f'  <link rel="stylesheet" href="{assets_prefix}css/modern-style.css">\n</head>', 1)
    
    # Add styleToggle.js if not already present
    if 'styleToggle.js' not in content:
        # Try to insert before first script tag or before </body>
        script_patterns = [
            re.compile(r'(<script[^>]*src="[^"]*assets/js/[^"]+\.js"[^>]*>)'),
            re.compile(r'(<script[^>]*type="module"[^>]*>)'),
            re.compile(r'(<script>)'),
            re.compile(r'(</body>)'),
        ]
        
        for pattern in script_patterns:
            if pattern.search(content):
                if pattern.pattern == r'(</body>)':
                    content = pattern.sub(f'  <script src="{assets_prefix}js/styleToggle.js"></script>\n\\1', content, count=1)
                else:
                    content = pattern.sub(f'<script src="{assets_prefix}js/styleToggle.js"></script>\n  \\1', content, count=1)
                break
    
    # Write back if changed
    if content != original_content:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Updated: {filepath}")
        return True
    return False

# Process all HTML files
updated_count = 0
for dirpath, _, files in os.walk(root_dir):
    # Skip certain directories
    if '.git' in dirpath or 'wip' in dirpath:
        continue
    
    for file in files:
        if file.endswith('.html'):
            path = os.path.join(dirpath, file)
            if add_modern_style_support(path):
                updated_count += 1

print(f"\nTotal files updated: {updated_count}")
