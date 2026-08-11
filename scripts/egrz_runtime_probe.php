<?php
/**
 * Read-only EGRZ integration probe.
 *
 * Run only from Timeweb CLI:
 *   php "$HOME/dimasites-deploy/scripts/egrz_runtime_probe.php"
 *
 * It prints response structure and possible API routes. It never changes the site.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only.\n");
    exit(1);
}
if (!function_exists('curl_init')) {
    fwrite(STDERR, "PHP curl extension is required.\n");
    exit(1);
}

function probe_fetch($url, $timeout)
{
    $curl = curl_init($url);
    curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($curl, CURLOPT_HEADER, false);
    curl_setopt($curl, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($curl, CURLOPT_MAXREDIRS, 3);
    curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 8);
    curl_setopt($curl, CURLOPT_TIMEOUT, $timeout);
    curl_setopt($curl, CURLOPT_ENCODING, '');
    curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, 2);
    curl_setopt($curl, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36');
    curl_setopt($curl, CURLOPT_HTTPHEADER, array(
        'Accept: text/html,application/xhtml+xml,application/json,application/javascript,*/*;q=0.8',
        'Accept-Language: ru-RU,ru;q=0.9'
    ));
    if (defined('CURLOPT_IPRESOLVE') && defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($curl, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    if (defined('CURLOPT_HTTP_VERSION') && defined('CURL_HTTP_VERSION_1_1')) {
        curl_setopt($curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    }
    $body = curl_exec($curl);
    $result = array(
        'ok' => $body !== false && curl_errno($curl) === 0,
        'status' => (int) curl_getinfo($curl, CURLINFO_HTTP_CODE),
        'url' => (string) curl_getinfo($curl, CURLINFO_EFFECTIVE_URL),
        'type' => (string) curl_getinfo($curl, CURLINFO_CONTENT_TYPE),
        'errno' => curl_errno($curl),
        'error' => curl_error($curl),
        'body' => $body === false ? '' : $body
    );
    curl_close($curl);
    return $result;
}

function probe_absolute_url($base, $href)
{
    $href = html_entity_decode(trim($href), ENT_QUOTES, 'UTF-8');
    if ($href === '') { return ''; }
    if (strpos($href, '//') === 0) { return 'https:' . $href; }
    if (preg_match('#^https://#i', $href)) { return $href; }
    if (strpos($href, '/') === 0) { return 'https://egrz.ru' . $href; }
    return rtrim(dirname($base), '/') . '/' . ltrim($href, '/');
}

function probe_summary($label, $response)
{
    printf(
        "%s: HTTP=%d CURL=%d TYPE=%s BYTES=%d SHA256=%s URL=%s\n",
        $label,
        $response['status'],
        $response['errno'],
        $response['type'] === '' ? '-' : $response['type'],
        strlen($response['body']),
        $response['body'] === '' ? '-' : hash('sha256', $response['body']),
        $response['url'] === '' ? '-' : $response['url']
    );
    if (!$response['ok']) {
        printf("  ERROR=%s\n", $response['error'] === '' ? 'request_failed' : $response['error']);
    }
}

$pageUrl = 'https://egrz.ru/organisation/reestr-advance/latest';
$page = probe_fetch($pageUrl, 30);
probe_summary('PAGE', $page);
if (!$page['ok'] || $page['status'] < 200 || $page['status'] >= 400) {
    exit(2);
}

$html = $page['body'];
printf(
    "STRUCTURE: forms=%d inputs=%d scripts=%d contains-search-label=%s\n",
    preg_match_all('/<form\b/iu', $html),
    preg_match_all('/<input\b/iu', $html),
    preg_match_all('/<script\b/iu', $html),
    stripos($html, 'Номер заключения экспертизы') !== false ? 'yes' : 'no'
);

$scriptUrls = array();
if (preg_match_all('/<script\b[^>]*\bsrc\s*=\s*(["\x27])(.*?)\1/isu', $html, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $match) {
        $url = probe_absolute_url($pageUrl, $match[2]);
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if (($host === 'egrz.ru' || $host === 'www.egrz.ru' || $host === 'open-api.egrz.ru') && !isset($scriptUrls[$url])) {
            $scriptUrls[$url] = true;
        }
    }
}

echo "SCRIPTS:\n";
if (!$scriptUrls) {
    echo "  none discovered in server HTML\n";
} else {
    foreach (array_keys($scriptUrls) as $url) { echo "  " . $url . "\n"; }
}

$interesting = array();
$checked = 0;
foreach (array_keys($scriptUrls) as $scriptUrl) {
    if ($checked >= 12) { break; }
    $checked++;
    $script = probe_fetch($scriptUrl, 25);
    probe_summary('SCRIPT ' . $checked, $script);
    if (!$script['ok'] || strlen($script['body']) > 8000000) { continue; }
    if (preg_match_all('/(["\x27])([^"\x27]{0,220}(?:open-api|\/api\/|reestr|search|expertise|conclusion)[^"\x27]{0,220})\1/iu', $script['body'], $strings, PREG_SET_ORDER)) {
        foreach ($strings as $stringMatch) {
            $candidate = preg_replace('/\\\\\//', '/', trim($stringMatch[2]));
            if ($candidate === null || strlen($candidate) < 4 || strlen($candidate) > 440) { continue; }
            if (strpos($candidate, '/') === false && stripos($candidate, 'api') === false) { continue; }
            $interesting[$candidate] = true;
            if (count($interesting) >= 80) { break 2; }
        }
    }
}

echo "POSSIBLE_ENDPOINTS:\n";
if (!$interesting) {
    echo "  none discovered\n";
} else {
    foreach (array_keys($interesting) as $candidate) { echo "  " . $candidate . "\n"; }
}

echo "OPEN_API_PROBES:\n";
$apiUrls = array(
    'https://open-api.egrz.ru/',
    'https://open-api.egrz.ru/swagger-ui/index.html',
    'https://open-api.egrz.ru/swagger-ui.html',
    'https://open-api.egrz.ru/v3/api-docs',
    'https://open-api.egrz.ru/openapi.json',
    'https://open-api.egrz.ru/swagger/v1/swagger.json'
);
foreach ($apiUrls as $apiUrl) {
    $apiResponse = probe_fetch($apiUrl, 15);
    probe_summary('OPEN_API', $apiResponse);
}

echo "Probe complete. Copy all output back to the developer.\n";
