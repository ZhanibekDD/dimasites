<?php
/**
 * Read-only network/TLS diagnostics for the official source adapters.
 *
 * This script is intentionally CLI-only. It stores no response bodies and
 * prints no cookies or credentials; only transport metadata and safe markers.
 */

if (PHP_SAPI !== 'cli') {
    fwrite(STDERR, "CLI only.\n");
    exit(1);
}

if (!function_exists('curl_init')) {
    fwrite(STDERR, "PHP cURL extension is required.\n");
    exit(1);
}

$eisNumber = '0372200102526000003';
$targets = array(
    array(
        'name' => 'fns_search_page',
        'url' => 'https://pb.nalog.ru/search.html',
        'marker' => 'search-proc.json',
    ),
    array(
        'name' => 'egrz_registry_page',
        'url' => 'https://egrz.ru/organisation/reestr-advance/latest',
        'marker' => 'reestr',
    ),
    array(
        'name' => 'egrz_open_api_root',
        'url' => 'https://open-api.egrz.ru/',
        'marker' => '',
    ),
    array(
        'name' => 'eis_exact_procurement',
        'url' => 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' . rawurlencode($eisNumber) . '&morphology=on&search-filter=%D0%94%D0%B0%D1%82%D0%B5+%D1%80%D0%B0%D0%B7%D0%BC%D0%B5%D1%89%D0%B5%D0%BD%D0%B8%D1%8F&fz44=on&fz223=on&af=on&ca=on&pc=on&pa=on',
        'marker' => $eisNumber,
    ),
);

function dnepr_probe_target($target)
{
    $curl = curl_init($target['url']);
    curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($curl, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($curl, CURLOPT_MAXREDIRS, 5);
    curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 15);
    curl_setopt($curl, CURLOPT_TIMEOUT, 45);
    curl_setopt($curl, CURLOPT_ENCODING, '');
    curl_setopt($curl, CURLOPT_HTTPHEADER, array(
        'Accept: text/html,application/json;q=0.9,*/*;q=0.7',
        'Cache-Control: no-cache',
    ));
    curl_setopt($curl, CURLOPT_USERAGENT, 'DNEPR-Source-Probe/1.0');
    if (defined('CURLOPT_IPRESOLVE') && defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($curl, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    if (defined('CURL_HTTP_VERSION_1_1')) {
        curl_setopt($curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    }

    $started = microtime(true);
    $body = curl_exec($curl);
    $errorNumber = curl_errno($curl);
    $errorMessage = curl_error($curl);
    $info = curl_getinfo($curl);
    curl_close($curl);

    $httpCode = isset($info['http_code']) ? (int) $info['http_code'] : 0;
    $marker = isset($target['marker']) ? (string) $target['marker'] : '';
    $markerFound = false;
    if (is_string($body) && $marker !== '') {
        $markerFound = strpos($body, $marker) !== false;
    }

    return array(
        'name' => $target['name'],
        'url' => $target['url'],
        'transport_ok' => $errorNumber === 0 && $httpCode >= 200 && $httpCode < 400,
        'marker' => $marker,
        'marker_found' => $markerFound,
        'http_code' => $httpCode,
        'curl_errno' => $errorNumber,
        'curl_error' => $errorMessage,
        'primary_ip' => isset($info['primary_ip']) ? $info['primary_ip'] : '',
        'content_type' => isset($info['content_type']) ? $info['content_type'] : '',
        'ssl_verify_result' => isset($info['ssl_verify_result']) ? $info['ssl_verify_result'] : null,
        'redirect_count' => isset($info['redirect_count']) ? (int) $info['redirect_count'] : 0,
        'total_time_ms' => (int) round((microtime(true) - $started) * 1000),
        'response_bytes' => is_string($body) ? strlen($body) : 0,
        'response_sha256' => is_string($body) ? hash('sha256', $body) : '',
    );
}

$results = array();
foreach ($targets as $target) {
    $results[] = dnepr_probe_target($target);
}

$report = array(
    'schema' => 'dnepr-source-probe/1.0',
    'created_at' => gmdate('c'),
    'php_version' => PHP_VERSION,
    'curl_version' => function_exists('curl_version') ? curl_version() : array(),
    'results' => $results,
);

$jsonOptions = 0;
if (defined('JSON_PRETTY_PRINT')) {
    $jsonOptions |= constant('JSON_PRETTY_PRINT');
}
if (defined('JSON_UNESCAPED_SLASHES')) {
    $jsonOptions |= constant('JSON_UNESCAPED_SLASHES');
}
if (defined('JSON_UNESCAPED_UNICODE')) {
    $jsonOptions |= constant('JSON_UNESCAPED_UNICODE');
}
echo json_encode($report, $jsonOptions), "\n";
