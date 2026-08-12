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

function probe_origin($url)
{
    $parts = parse_url($url);
    if (!is_array($parts) || empty($parts['host'])) { return ''; }
    $scheme = isset($parts['scheme']) ? strtolower($parts['scheme']) : 'https';
    $origin = $scheme . '://' . $parts['host'];
    if (isset($parts['port'])) { $origin .= ':' . $parts['port']; }
    return $origin;
}

function probe_absolute_url($base, $href)
{
    $href = html_entity_decode(trim($href), ENT_QUOTES, 'UTF-8');
    if ($href === '') { return ''; }
    if (strpos($href, '//') === 0) { return 'https:' . $href; }
    if (preg_match('#^https?://#i', $href)) { return $href; }

    $origin = probe_origin($base);
    if ($origin === '') { return ''; }
    if (strpos($href, '/') === 0) { return $origin . $href; }

    $basePath = (string) parse_url($base, PHP_URL_PATH);
    if ($basePath === '' || substr($basePath, -1) !== '/') {
        $basePath = rtrim(str_replace('\\', '/', dirname($basePath)), '/') . '/';
    }
    return $origin . $basePath . ltrim($href, '/');
}

function probe_is_html_response($response)
{
    $type = strtolower((string) $response['type']);
    if (strpos($type, 'text/html') !== false || strpos($type, 'application/xhtml') !== false) {
        return true;
    }
    return preg_match('/^\s*(?:<!doctype\s+html|<html\b)/iu', (string) $response['body']) === 1;
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

// Angular applications commonly publish relative bundle names together with
// <base href="/">. Browser URL resolution must use that base, not dirname(page URL).
$assetBaseUrl = $page['url'] !== '' ? $page['url'] : $pageUrl;
if (preg_match('/<base\b[^>]*\bhref\s*=\s*(["\x27])(.*?)\1/isu', $html, $baseMatch)) {
    $resolvedBase = probe_absolute_url($assetBaseUrl, $baseMatch[2]);
    if ($resolvedBase !== '') { $assetBaseUrl = $resolvedBase; }
}
echo "ASSET_BASE: " . $assetBaseUrl . "\n";

$scriptUrls = array();
if (preg_match_all('/<script\b[^>]*\bsrc\s*=\s*(["\x27])(.*?)\1/isu', $html, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $match) {
        $url = probe_absolute_url($assetBaseUrl, $match[2]);
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
$bundleBodies = array();
$checked = 0;
foreach (array_keys($scriptUrls) as $scriptUrl) {
    if ($checked >= 12) { break; }
    $checked++;
    $script = probe_fetch($scriptUrl, 25);
    probe_summary('SCRIPT ' . $checked, $script);
    if (!$script['ok']) { continue; }
    if (probe_is_html_response($script)) {
        echo "  REJECTED=html_fallback_not_javascript\n";
        continue;
    }
    if (strlen($script['body']) > 12000000) {
        echo "  REJECTED=bundle_too_large\n";
        continue;
    }
    $bundleBodies[$scriptUrl] = $script['body'];
    if (preg_match_all('/(["\x27])([^"\x27]{0,260}(?:open-api|\/api\/|reestr|search|expertise|conclusion)[^"\x27]{0,260})\1/iu', $script['body'], $strings, PREG_SET_ORDER)) {
        foreach ($strings as $stringMatch) {
            $candidate = preg_replace('/\\\\\//', '/', trim($stringMatch[2]));
            if ($candidate === null || strlen($candidate) < 4 || strlen($candidate) > 520) { continue; }
            if (strpos($candidate, '/') === false && stripos($candidate, 'api') === false) { continue; }
            $interesting[$candidate] = true;
            if (count($interesting) >= 120) { break 2; }
        }
    }
}

echo "POSSIBLE_ENDPOINTS:\n";
if (!$interesting) {
    echo "  none discovered\n";
} else {
    foreach (array_keys($interesting) as $candidate) { echo "  " . $candidate . "\n"; }
}

// Print only the small, relevant pieces of the minified Angular application.
// This is intentionally placed after the broad inventory so the final screen of
// terminal output contains the values needed to implement the real adapter.
$targetNames = array(
    'PrivatePortal_SEARCH_API',
    'searchAPI',
    'searchGetSearchParameters',
    'searchGetSearchParametersByKOSFN',
    'searchExpertiseSimple',
    'searchExpertise',
    'searchBuildingObjectsSimple'
);

echo "TARGET_ASSIGNMENTS:\n";
$assignments = array();
foreach ($bundleBodies as $bundleUrl => $bundleBody) {
    foreach ($targetNames as $targetName) {
        $pattern = '/(?:[A-Za-z_$][A-Za-z0-9_$]*\\.)?' . preg_quote($targetName, '/') . '\\s*=\\s*([^,;]{1,900})/u';
        if (!preg_match_all($pattern, $bundleBody, $targetMatches, PREG_SET_ORDER)) { continue; }
        foreach ($targetMatches as $targetMatch) {
            $value = preg_replace('/\\s+/', ' ', trim($targetMatch[1]));
            if ($value === null || $value === '') { continue; }
            $key = $targetName . '=' . $value;
            if (isset($assignments[$key])) { continue; }
            $assignments[$key] = true;
            printf("  %s=%s [bundle=%s]\n", $targetName, $value, basename((string) parse_url($bundleUrl, PHP_URL_PATH)));
        }
    }
}
if (!$assignments) { echo "  none extracted\n"; }

echo "TARGET_CONTEXTS:\n";
$contextNeedles = array(
    'searchGetSearchParameters=',
    'searchExpertiseSimple=',
    'searchExpertise=',
    '.searchExpertiseSimple',
    '.searchExpertise('
);
$printedContexts = array();
foreach ($bundleBodies as $bundleUrl => $bundleBody) {
    foreach ($contextNeedles as $needle) {
        $offset = 0;
        $occurrences = 0;
        while (($position = strpos($bundleBody, $needle, $offset)) !== false && $occurrences < 2) {
            $start = max(0, $position - 700);
            $snippet = substr($bundleBody, $start, 2300);
            $snippet = preg_replace('/\\s+/', ' ', $snippet);
            if ($snippet !== null) {
                $contextKey = hash('sha256', $snippet);
                if (!isset($printedContexts[$contextKey])) {
                    $printedContexts[$contextKey] = true;
                    printf("  [%s @ %d in %s]\n%s\n", $needle, $position, basename((string) parse_url($bundleUrl, PHP_URL_PATH)), $snippet);
                }
            }
            $offset = $position + strlen($needle);
            $occurrences++;
        }
    }
}
if (!$printedContexts) { echo "  none extracted\n"; }

echo "PUBLIC_SEARCH_PROBES:\n";
$publicSearchUrls = array(
    'http://reestr.egrz.ru/EGRZ/api/Search/inputSettings',
    'https://reestr.egrz.ru/EGRZ/api/Search/inputSettings'
);
foreach ($publicSearchUrls as $publicSearchUrl) {
    $publicSearchResponse = probe_fetch($publicSearchUrl, 20);
    probe_summary('PUBLIC_SEARCH', $publicSearchResponse);
    if ($publicSearchResponse['body'] !== '' && strlen($publicSearchResponse['body']) <= 120000 && !probe_is_html_response($publicSearchResponse)) {
        $preview = substr($publicSearchResponse['body'], 0, 5000);
        $preview = preg_replace('/\\s+/', ' ', $preview);
        echo "  BODY=" . ($preview === null ? '-' : $preview) . "\n";
    }
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
