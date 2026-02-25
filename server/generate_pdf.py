"""
專甘管 - PDF 匯出工具 (含甘特圖視覺化)
使用 reportlab 生成專案全階層 PDF 報表 + 甘特圖
用法: python generate_pdf.py <json_data_file> <output_file>
"""
import sys
import json
from datetime import datetime
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, PageBreak
from reportlab.graphics.shapes import Drawing, Rect, String, Line
from reportlab.graphics import renderPDF
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# Try to register a CJK font for Chinese characters
try:
    pdfmetrics.registerFont(TTFont('NotoSansTC', 'NotoSansTC-Regular.ttf'))
    CJK_FONT = 'NotoSansTC'
except:
    try:
        pdfmetrics.registerFont(TTFont('MSGothic', 'C:/Windows/Fonts/msjh.ttc'))
        CJK_FONT = 'MSGothic'
    except:
        CJK_FONT = 'Helvetica'

# Color palette for depth levels
DEPTH_COLORS = [
    colors.HexColor('#6366f1'),  # indigo 
    colors.HexColor('#22c55e'),  # green
    colors.HexColor('#f59e0b'),  # amber
    colors.HexColor('#ef4444'),  # red
    colors.HexColor('#8b5cf6'),  # violet
    colors.HexColor('#06b6d4'),  # cyan
]

DEPTH_COLORS_LIGHT = [
    colors.HexColor('#e0e7ff'),
    colors.HexColor('#dcfce7'),
    colors.HexColor('#fef3c7'),
    colors.HexColor('#fee2e2'),
    colors.HexColor('#ede9fe'),
    colors.HexColor('#cffafe'),
]

COMPLETED_COLOR = colors.HexColor('#22c55e')
STAGE_COLOR = colors.HexColor('#A78355')

def create_styles():
    styles = getSampleStyleSheet()
    styles.add(ParagraphStyle(name='CJKTitle', fontName=CJK_FONT, fontSize=18, leading=24, spaceAfter=12, textColor=colors.HexColor('#1E293B')))
    styles.add(ParagraphStyle(name='CJKSubtitle', fontName=CJK_FONT, fontSize=12, leading=16, spaceAfter=8, textColor=colors.HexColor('#71717A')))
    styles.add(ParagraphStyle(name='CJKNormal', fontName=CJK_FONT, fontSize=10, leading=14))
    styles.add(ParagraphStyle(name='CJKSmall', fontName=CJK_FONT, fontSize=8, leading=11))
    return styles

def parse_date(s):
    """Parse ISO date string to datetime"""
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace('Z', '+00:00'))
    except:
        try:
            return datetime.strptime(s[:19], '%Y-%m-%dT%H:%M:%S')
        except:
            return datetime.strptime(s[:10], '%Y-%m-%d')

def flatten_tasks(tasks, depth=0):
    """Recursively flatten task tree into rows with depth info"""
    rows = []
    for task in tasks:
        rows.append({
            'depth': depth,
            'name': task.get('name', ''),
            'department': task.get('department', ''),
            'start_date': task.get('start_date', ''),
            'end_date': task.get('end_date', ''),
            'status': task.get('status', 'pending'),
            'progress': task.get('progress', 0)
        })
        children = task.get('children', [])
        if children:
            rows.extend(flatten_tasks(children, depth + 1))
    return rows

def draw_gantt_chart(data, page_width, page_height):
    """Draw a complete Gantt chart as a Drawing object"""
    # Parse all dates to find min/max
    all_dates = []
    stages = data.get('stages', [])
    
    for stage in stages:
        sd = parse_date(stage.get('start_date'))
        ed = parse_date(stage.get('end_date'))
        if sd: all_dates.append(sd)
        if ed: all_dates.append(ed)
        for row in flatten_tasks(stage.get('tasks', [])):
            sd2 = parse_date(row['start_date'])
            ed2 = parse_date(row['end_date'])
            if sd2: all_dates.append(sd2)
            if ed2: all_dates.append(ed2)

    if len(all_dates) < 2:
        return None

    min_date = min(all_dates)
    max_date = max(all_dates)
    total_days = max(1, (max_date - min_date).days)

    # Collect all rows: stages + tasks
    gantt_rows = []
    for stage in stages:
        gantt_rows.append({
            'type': 'stage',
            'name': stage['name'],
            'start_date': stage.get('start_date', ''),
            'end_date': stage.get('end_date', ''),
            'depth': -1,
            'status': ''
        })
        for row in flatten_tasks(stage.get('tasks', [])):
            gantt_rows.append({**row, 'type': 'task'})

    if not gantt_rows:
        return None

    # Layout dimensions
    label_width = 130
    chart_left = label_width + 10
    chart_width = page_width - chart_left - 20
    row_height = 16
    header_height = 30
    total_height = header_height + len(gantt_rows) * row_height + 20

    d = Drawing(page_width, total_height)

    # Background
    d.add(Rect(0, 0, page_width, total_height, fillColor=colors.HexColor('#FAFAF9'), strokeColor=None))

    # Timeline header
    y_top = total_height - header_height

    # Draw date markers
    num_markers = min(total_days + 1, 15)  # Max 15 date markers
    step = max(1, total_days // (num_markers - 1)) if num_markers > 1 else 1
    
    for i in range(0, total_days + 1, step):
        x = chart_left + (i / total_days) * chart_width
        date_label = (min_date + __import__('datetime').timedelta(days=i)).strftime('%m/%d')
        d.add(String(x, y_top + 8, date_label, fontName=CJK_FONT, fontSize=7, fillColor=colors.HexColor('#71717A'), textAnchor='middle'))
        # Vertical gridline
        d.add(Line(x, y_top, x, y_top - len(gantt_rows) * row_height, strokeColor=colors.HexColor('#E4E4E7'), strokeWidth=0.3))

    # Horizontal separator
    d.add(Line(0, y_top, page_width, y_top, strokeColor=colors.HexColor('#D4D4D8'), strokeWidth=0.5))

    # Draw rows
    for idx, row in enumerate(gantt_rows):
        y = y_top - (idx + 1) * row_height
        is_stage = row['type'] == 'stage'
        depth = row.get('depth', 0)

        # Alternating row background
        if idx % 2 == 0:
            d.add(Rect(0, y, page_width, row_height, fillColor=colors.HexColor('#FFFFFF'), strokeColor=None))
        
        # Row label
        indent = 0 if is_stage else (depth * 8 + 8)
        label = row['name']
        if len(label) > 14:
            label = label[:13] + '..'
        
        font_size = 7.5 if is_stage else 6.5
        font_color = colors.HexColor('#1E293B') if is_stage else colors.HexColor('#52525B')
        
        d.add(String(
            4 + indent, y + row_height / 2 - 3,
            label, fontName=CJK_FONT, fontSize=font_size, fillColor=font_color
        ))

        # Draw bar
        sd = parse_date(row.get('start_date', ''))
        ed = parse_date(row.get('end_date', ''))
        if sd and ed:
            start_offset = max(0, (sd - min_date).days)
            end_offset = min(total_days, (ed - min_date).days)
            
            bar_x = chart_left + (start_offset / total_days) * chart_width
            bar_w = max(2, ((end_offset - start_offset) / total_days) * chart_width)
            bar_h = row_height * 0.55
            bar_y = y + (row_height - bar_h) / 2

            if is_stage:
                # Stage: wider, muted bar
                bar_color = STAGE_COLOR
                d.add(Rect(bar_x, bar_y, bar_w, bar_h, fillColor=bar_color, strokeColor=None, rx=2, ry=2))
            else:
                # Task bar
                color_idx = depth % len(DEPTH_COLORS)
                bar_color = DEPTH_COLORS[color_idx]
                bg_color = DEPTH_COLORS_LIGHT[color_idx]
                
                # Background bar
                d.add(Rect(bar_x, bar_y, bar_w, bar_h, fillColor=bg_color, strokeColor=None, rx=2, ry=2))
                
                # Progress fill
                progress = row.get('progress', 0) or 0
                if progress > 0:
                    fill_w = bar_w * (progress / 100)
                    fill_color = COMPLETED_COLOR if row.get('status') == 'completed' else bar_color
                    d.add(Rect(bar_x, bar_y, fill_w, bar_h, fillColor=fill_color, strokeColor=None, rx=2, ry=2))

                # Completed indicator
                if row.get('status') == 'completed':
                    d.add(String(bar_x + bar_w + 3, bar_y + 1, '✓', fontName=CJK_FONT, fontSize=6, fillColor=COMPLETED_COLOR))

        # Row bottom border
        d.add(Line(0, y, page_width, y, strokeColor=colors.HexColor('#F4F4F5'), strokeWidth=0.3))

    return d

def generate_pdf(data, output_path):
    styles = create_styles()
    doc = SimpleDocTemplate(
        output_path,
        pagesize=landscape(A4),
        leftMargin=15*mm,
        rightMargin=15*mm,
        topMargin=15*mm,
        bottomMargin=15*mm
    )
    
    page_width = landscape(A4)[0] - 30*mm
    page_height = landscape(A4)[1] - 30*mm
    
    story = []
    
    # Title
    story.append(Paragraph(data['name'], styles['CJKTitle']))
    story.append(Paragraph(
        f"起始: {(data.get('start_date','N/A'))[:10]}  |  結束: {(data.get('end_date','N/A'))[:10]}",
        styles['CJKSubtitle']
    ))
    story.append(Spacer(1, 6*mm))
    
    # === GANTT CHART PAGE ===
    gantt_drawing = draw_gantt_chart(data, page_width, page_height)
    if gantt_drawing:
        story.append(Paragraph("📊 甘特圖總覽", styles['CJKSubtitle']))
        story.append(Spacer(1, 3*mm))
        story.append(gantt_drawing)

    # === DETAIL TABLES (next page) ===
    story.append(PageBreak())
    story.append(Paragraph("📋 任務明細", styles['CJKTitle']))
    story.append(Spacer(1, 6*mm))
    
    for stage in data.get('stages', []):
        story.append(Paragraph(f"階段: {stage['name']}", styles['CJKSubtitle']))
        story.append(Paragraph(
            f"{stage.get('start_date', '')[:10]} ~ {stage.get('end_date', '')[:10]}",
            styles['CJKSmall']
        ))
        story.append(Spacer(1, 3*mm))
        
        header = ['層級', '任務名稱', '負責部門', '起始時間', '結束時間', '狀態']
        table_data = [header]
        task_rows = flatten_tasks(stage.get('tasks', []))
        
        for row in task_rows:
            indent = '  ' * row['depth']
            level = f"L{row['depth'] + 1}"
            status_text = '✅ 完成' if row['status'] == 'completed' else '⏳ 進行中'
            
            table_data.append([
                Paragraph(level, styles['CJKSmall']),
                Paragraph(f"{indent}{row['name']}", styles['CJKNormal']),
                Paragraph(row['department'], styles['CJKSmall']),
                Paragraph(row['start_date'][:16].replace('T', ' '), styles['CJKSmall']),
                Paragraph(row['end_date'][:16].replace('T', ' '), styles['CJKSmall']),
                Paragraph(status_text, styles['CJKSmall'])
            ])
        
        if len(table_data) > 1:
            col_widths = [30*mm, 80*mm, 35*mm, 45*mm, 45*mm, 30*mm]
            table = Table(table_data, colWidths=col_widths)
            
            style_cmds = [
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#A78355')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, 0), CJK_FONT),
                ('FONTSIZE', (0, 0), (-1, 0), 9),
                ('ALIGN', (0, 0), (-1, 0), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#E4E4E7')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#FAFAF9')]),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                ('TOPPADDING', (0, 0), (-1, -1), 4),
            ]
            
            for i, row in enumerate(task_rows, start=1):
                if row['status'] == 'completed':
                    style_cmds.append(('BACKGROUND', (0, i), (-1, i), colors.HexColor('#F0FDF4')))
            
            table.setStyle(TableStyle(style_cmds))
            story.append(table)
        else:
            story.append(Paragraph('（無任務）', styles['CJKSmall']))
        
        story.append(Spacer(1, 8*mm))
    
    doc.build(story)
    print(f"PDF generated: {output_path}")

if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python generate_pdf.py <json_data_file> <output_file>")
        sys.exit(1)
    
    with open(sys.argv[1], 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    generate_pdf(data, sys.argv[2])
