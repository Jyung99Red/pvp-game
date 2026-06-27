#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
拖拽合并脚本
用法：把文件/文件夹拖到本脚本上运行，或命令行 python build.py file1 file2 ...

CSS  → 内联到 <style>
JS   → 内联到 <script>
SVG  → 收集所有 .svg，转为 <symbol> 内联到 <body> 开头
       symbol id = 父文件夹/文件名，例如：
       icons/weapons/sword.svg  → id="weapons/sword"
       icons/enemies/goblin.svg → id="enemies/goblin"
       HTML里用：<svg class="game-icon"><use href="#weapons/sword"/></svg>

index.html 占位符（可选）：
  <!-- BUILD:CSS -->
  <!-- BUILD:SVG -->
  <!-- BUILD:JS -->
"""

import sys
import re
from pathlib import Path

FIXED_FIRST = ['index', 'state']

def priority(path: Path) -> tuple:
    name = path.stem.lower()
    for i, kw in enumerate(FIXED_FIRST):
        if name == kw or name.startswith(kw + '.') or name.startswith(kw + '_') or name.endswith('_' + kw):
            return (i, name)
    return (len(FIXED_FIRST), name)

def collect_files(args) -> dict:
    html_files, css_files, js_files, svg_files = [], [], [], []
    for arg in args:
        p = Path(arg)
        if p.is_dir():
            html_files += list(p.rglob('*.html'))
            css_files  += list(p.rglob('*.css'))
            js_files   += list(p.rglob('*.js'))
            svg_files  += list(p.rglob('*.svg'))
        elif p.is_file():
            ext = p.suffix.lower()
            if ext == '.html':  html_files.append(p)
            elif ext == '.css': css_files.append(p)
            elif ext == '.js':  js_files.append(p)
            elif ext == '.svg': svg_files.append(p)
    return {
        'html': sorted(html_files, key=priority),
        'css':  sorted(css_files,  key=priority),
        'js':   sorted(js_files,   key=priority),
        'svg':  sorted(svg_files,  key=lambda p: str(p)),
    }

def read(path: Path) -> str:
    return path.read_text(encoding='utf-8').replace('\r\n', '\n').replace('\r', '\n')

def wrap_comment(filename: str, content: str) -> str:
    sep = '=' * 60
    return f'/* {sep}\n   {filename}\n   {sep} */\n{content}'

def make_symbol_id(svg_path: Path) -> str:
    """
    icons/weapons/sword.svg  → weapons/sword
    icons/sword.svg          → sword
    sword.svg                → sword
    """
    parts = svg_path.parts
    try:
        idx = next(i for i, p in enumerate(parts) if p.lower() == 'icons')
        rel = list(parts[idx + 1:])
    except StopIteration:
        rel = list(parts[-2:]) if len(parts) >= 2 else list(parts)
    rel[-1] = Path(rel[-1]).stem
    return '/'.join(rel) if len(rel) > 1 else rel[0]

def build_svg_sprite(svg_files: list) -> str:
    if not svg_files:
        return ''
    symbols = []
    for f in svg_files:
        raw = read(f)
        vb_match = re.search(r'viewBox=["\']([^"\']+)["\']', raw, re.IGNORECASE)
        viewbox  = vb_match.group(1) if vb_match else '0 0 512 512'
        inner = re.sub(r'<\?xml[^>]*\?>', '', raw)
        inner = re.sub(r'<!--.*?-->', '', inner, flags=re.DOTALL)
        inner = re.sub(r'<svg[^>]*>', '', inner, count=1)
        inner = re.sub(r'</svg\s*>', '', inner).strip()
        sym_id = make_symbol_id(f)
        symbols.append(f'  <symbol id="{sym_id}" viewBox="{viewbox}">\n    {inner}\n  </symbol>')
    joined = '\n'.join(symbols)
    return f'<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">\n{joined}\n</svg>'

def build(files_map: dict) -> str:
    css_combined = '\n\n'.join(wrap_comment(f.name, read(f)) for f in files_map['css'])
    js_combined  = '\n\n'.join(wrap_comment(f.name, read(f)) for f in files_map['js'])
    svg_sprite   = build_svg_sprite(files_map['svg'])

    style_block  = f'<style>\n{css_combined}\n</style>'  if css_combined else ''
    script_block = f'<script>\n{js_combined}\n</script>' if js_combined  else ''

    if not files_map['html']:
        print('⚠️  未检测到 .html 文件，自动生成外壳')
        return f'''<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Game</title>
{style_block}
</head>
<body>
{svg_sprite}
{script_block}
</body>
</html>'''

    template = read(files_map['html'][0])

    extra_body = ''
    for f in files_map['html'][1:]:
        m = re.search(r'<body[^>]*>(.*?)</body>', read(f), re.DOTALL | re.IGNORECASE)
        if m:
            extra_body += f'\n<!-- from: {f.name} -->\n' + m.group(1).strip()

    # 注入 CSS
    if '<!-- BUILD:CSS -->' in template:
        template = template.replace('<!-- BUILD:CSS -->', style_block)
    elif style_block:
        template = template.replace('</head>', f'{style_block}\n</head>', 1)

    # 注入 SVG sprite（body开头）
    if '<!-- BUILD:SVG -->' in template:
        template = template.replace('<!-- BUILD:SVG -->', svg_sprite)
    elif svg_sprite:
        template = re.sub(r'(<body[^>]*>)', rf'\1\n{svg_sprite}', template, count=1)

    # 注入 JS
    inject = '\n'.join(filter(None, [extra_body, script_block]))
    if '<!-- BUILD:JS -->' in template:
        template = template.replace('<!-- BUILD:JS -->', script_block)
        if extra_body:
            template = template.replace('</body>', f'{extra_body}\n</body>', 1)
    elif inject:
        template = template.replace('</body>', f'{inject}\n</body>', 1)

    return template

def main():
    args = sys.argv[1:]
    if not args:
        print('用法：把文件或文件夹拖到本脚本上运行')
        print('  也可以：python build.py index.html state.js style.css icons/')
        input('\n按 Enter 退出...')
        return

    files_map = collect_files(args)
    if not any(files_map.values()):
        print('❌ 未找到任何可处理文件')
        input('按 Enter 退出...')
        return

    print('📋 合并内容：')
    labels = {'html': 'HTML', 'css': 'CSS', 'js': 'JS', 'svg': 'SVG → sprite'}
    for cat, flist in files_map.items():
        if flist:
            print(f'  [{labels[cat]}]')
            for f in flist:
                tag   = ' ← 优先' if cat in ('html','css','js') and priority(f)[0] < len(FIXED_FIRST) else ''
                extra = f'  →  id="{make_symbol_id(f)}"' if cat == 'svg' else ''
                print(f'    · {f.name}{tag}{extra}')

    result   = build(files_map)
    out_path = Path(__file__).parent / 'game_build.html'
    out_path.write_text(result, encoding='utf-8')

    size_kb = out_path.stat().st_size // 1024
    print(f'\n✅ 完成 → {out_path}  ({size_kb} KB)')
    if files_map['svg']:
        print(f'   SVG sprite: {len(files_map["svg"])} 个图标已内联')
    input('按 Enter 退出...')

if __name__ == '__main__':
    main()