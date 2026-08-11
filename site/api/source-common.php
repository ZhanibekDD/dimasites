<?php
/* Shared, PHP 5.3-compatible helpers for official-source gateways. */
if (!defined('DNEPR_SOURCE_GATEWAY')) {
    header('HTTP/1.1 404 Not Found');
    exit;
}

function dnepr_source_diagnostic_id($source)
{
    return strtoupper($source) . '-' . gmdate('Ymd-His') . '-' . substr(sha1(uniqid('', true) . mt_rand()), 0, 8);
}

function dnepr_source_private_directory()
{
    $candidates = array();
    if (isset($_SERVER['DOCUMENT_ROOT']) && $_SERVER['DOCUMENT_ROOT'] !== '') {
        $candidates[] = dirname(rtrim($_SERVER['DOCUMENT_ROOT'], '/')) . '/dnepr-private';
    }
    $home = getenv('HOME');
    if ($home !== false && $home !== '') {
        $candidates[] = rtrim($home, '/') . '/dnepr-private';
    }
    foreach (array_unique($candidates) as $directory) {
        if (is_dir($directory) && is_writable($directory)) {
            return $directory;
        }
    }
    return '';
}

function dnepr_source_log($source, $query, $state, $diagnosticId, $meta)
{
    $directory = dnepr_source_private_directory();
    if ($directory === '') {
        return;
    }
    $record = array(
        'source' => $source,
        'query' => $query,
        'state' => $state,
        'diagnostic_id' => $diagnosticId,
        'created_at' => gmdate('c'),
        'result_count' => isset($meta['result_count']) ? (int) $meta['result_count'] : 0,
        'http_status' => isset($meta['http_status']) ? (int) $meta['http_status'] : 0,
        'latency_ms' => isset($meta['latency_ms']) ? (int) $meta['latency_ms'] : 0,
        'error_code' => isset($meta['error_code']) ? (string) $meta['error_code'] : '',
        'message' => isset($meta['message']) ? (string) $meta['message'] : ''
    );
    if (isset($meta['results']) && is_array($meta['results'])) {
        $record['results'] = array_slice($meta['results'], 0, 10);
    }
    if (isset($meta['files']) && is_array($meta['files'])) {
        $record['files'] = array_slice($meta['files'], 0, 25);
    }
    $path = $directory . '/source-query-' . gmdate('Y-m') . '.jsonl';
    if (@file_put_contents($path, json_encode($record) . "\n", FILE_APPEND | LOCK_EX) !== false) {
        @chmod($path, 0600);
    }
}

function dnepr_source_normalize_text($value)
{
    $value = html_entity_decode(strip_tags((string) $value), ENT_QUOTES, 'UTF-8');
    $value = preg_replace('/\s+/u', ' ', $value);
    return trim($value === null ? '' : $value);
}

function dnepr_source_rate_allowed($source, $ip)
{
    $path = rtrim(sys_get_temp_dir(), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'dnepr-source-rate-' . sha1($source . '|' . $ip) . '.json';
    $now = time();
    $handle = @fopen($path, 'c+');
    if (!$handle || !@flock($handle, LOCK_EX)) { if ($handle) { fclose($handle); } return true; }
    $state = json_decode(stream_get_contents($handle), true);
    if (!is_array($state) || !isset($state['started']) || ($now - (int) $state['started']) >= 600) {
        $state = array('started' => $now, 'count' => 0);
    }
    $allowed = (int) $state['count'] < 30;
    if ($allowed) { $state['count'] = (int) $state['count'] + 1; }
    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($state));
    fflush($handle);
    flock($handle, LOCK_UN);
    fclose($handle);
    return $allowed;
}

function dnepr_source_absolute_url($base, $href, $allowedHosts)
{
    $href = html_entity_decode(trim((string) $href), ENT_QUOTES, 'UTF-8');
    if ($href === '' || strpos($href, 'javascript:') === 0 || strpos($href, '#') === 0) {
        return null;
    }
    if (strpos($href, '//') === 0) {
        $href = 'https:' . $href;
    } elseif (strpos($href, '/') === 0) {
        $parts = parse_url($base);
        $href = 'https://' . $parts['host'] . $href;
    } elseif (!preg_match('#^https?://#i', $href)) {
        $href = rtrim(dirname($base), '/') . '/' . ltrim($href, '/');
    }
    $parts = @parse_url($href);
    if (!is_array($parts) || !isset($parts['scheme']) || !isset($parts['host'])) {
        return null;
    }
    $host = strtolower($parts['host']);
    if (strtolower($parts['scheme']) !== 'https' || !in_array($host, $allowedHosts, true)) {
        return null;
    }
    return $href;
}

function dnepr_source_http_request($method, $url, $headers, $cookieFile, $fields)
{
    if (!function_exists('curl_init')) {
        return array('ok' => false, 'status' => 0, 'errno' => -1, 'error' => 'curl_missing', 'body' => '', 'latency_ms' => 0);
    }
    $started = microtime(true);
    $curl = curl_init($url);
    curl_setopt($curl, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($curl, CURLOPT_HEADER, false);
    curl_setopt($curl, CURLOPT_CONNECTTIMEOUT, 8);
    curl_setopt($curl, CURLOPT_TIMEOUT, 24);
    curl_setopt($curl, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($curl, CURLOPT_MAXREDIRS, 3);
    curl_setopt($curl, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($curl, CURLOPT_SSL_VERIFYHOST, 2);
    curl_setopt($curl, CURLOPT_ENCODING, '');
    curl_setopt($curl, CURLOPT_USERAGENT, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36');
    curl_setopt($curl, CURLOPT_HTTPHEADER, $headers);
    if (strtoupper($method) === 'POST') {
        curl_setopt($curl, CURLOPT_POST, true);
        curl_setopt($curl, CURLOPT_POSTFIELDS, is_array($fields) ? http_build_query($fields, '', '&') : (string) $fields);
    }
    if ($cookieFile !== '') {
        curl_setopt($curl, CURLOPT_COOKIEJAR, $cookieFile);
        curl_setopt($curl, CURLOPT_COOKIEFILE, $cookieFile);
    }
    if (defined('CURLOPT_IPRESOLVE') && defined('CURL_IPRESOLVE_V4')) {
        curl_setopt($curl, CURLOPT_IPRESOLVE, CURL_IPRESOLVE_V4);
    }
    if (defined('CURLOPT_PROTOCOLS') && defined('CURLPROTO_HTTPS')) {
        curl_setopt($curl, CURLOPT_PROTOCOLS, CURLPROTO_HTTPS);
        curl_setopt($curl, CURLOPT_REDIR_PROTOCOLS, CURLPROTO_HTTPS);
    }
    if (defined('CURLOPT_HTTP_VERSION') && defined('CURL_HTTP_VERSION_1_1')) {
        curl_setopt($curl, CURLOPT_HTTP_VERSION, CURL_HTTP_VERSION_1_1);
    }
    $body = curl_exec($curl);
    $errno = curl_errno($curl);
    $error = curl_error($curl);
    $status = (int) curl_getinfo($curl, CURLINFO_HTTP_CODE);
    $effectiveUrl = (string) curl_getinfo($curl, CURLINFO_EFFECTIVE_URL);
    curl_close($curl);
    return array(
        'ok' => $body !== false && $errno === 0 && $status >= 200 && $status < 400,
        'status' => $status,
        'errno' => $errno,
        'error' => $error,
        'body' => $body === false ? '' : $body,
        'url' => $effectiveUrl,
        'latency_ms' => (int) round((microtime(true) - $started) * 1000)
    );
}

function dnepr_source_http_get($url, $headers, $cookieFile)
{
    return dnepr_source_http_request('GET', $url, $headers, $cookieFile, array());
}

function dnepr_source_http_post($url, $headers, $cookieFile, $fields)
{
    return dnepr_source_http_request('POST', $url, $headers, $cookieFile, $fields);
}

function dnepr_source_failure_message($errno, $status)
{
    if ((int) $errno === 28) { return 'Официальный источник не ответил за отведённое время.'; }
    if ((int) $errno === 6 || (int) $errno === 7) { return 'Сервер не смог установить соединение с официальным источником.'; }
    if ((int) $errno === 35 || (int) $errno === 60) { return 'Официальный источник использует несовместимые настройки защищённого соединения.'; }
    if ((int) $status === 403 || (int) $status === 429) { return 'Официальный источник ограничил автоматический запрос.'; }
    if ((int) $status >= 500) { return 'Официальный источник вернул временную серверную ошибку.'; }
    return 'Официальный источник временно не отдал данные.';
}

function dnepr_source_load_dom($html)
{
    if (!class_exists('DOMDocument')) { return null; }
    $dom = new DOMDocument();
    $previous = libxml_use_internal_errors(true);
    $loaded = $dom->loadHTML('<?xml encoding="UTF-8">' . $html);
    libxml_clear_errors();
    libxml_use_internal_errors($previous);
    return $loaded ? $dom : null;
}

function dnepr_source_xpath_text($xpath, $query, $context)
{
    $nodes = $xpath->query($query, $context);
    if ($nodes === false || $nodes->length === 0) { return ''; }
    return dnepr_source_normalize_text($nodes->item(0)->textContent);
}
