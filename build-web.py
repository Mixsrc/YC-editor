# Fabrique web/index.html (un seul fichier) à publier sur GitHub Pages : python3 web/build-web.py
import re, os
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__))); S = os.path.join(R, 'src') + os.sep; W = os.path.join(R, 'web') + os.sep
h = open(S + 'index.html', encoding='utf-8').read()
h = re.sub(r'<meta http-equiv="Content-Security-Policy"[^>]*>\n?', '', h)
h = h.replace('<title>YC Studio</title>', '<meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>YC Studio</title>')
h = h.replace('<link rel="stylesheet" href="styles.css">', '<style>\n' + open(S + 'styles.css', encoding='utf-8').read() + '\n</style>')
js = lambda f: '<script>\n' + open(f, encoding='utf-8').read().replace('</script', '<\\/script') + '\n</script>'
order = [S + 'yc-data.js', S + 'midi.js', W + 'web-host.js', S + 'i18n-data.js', S + 'i18n.js', S + 'app.js']
h = re.sub(r'<script src="yc-data.js"></script>.*?<script src="app.js"></script>', lambda m: '\n'.join(js(f) for f in order), h, flags=re.S)
open(W + 'index.html', 'w', encoding='utf-8').write(h); print(len(h) // 1024, 'Ko')
