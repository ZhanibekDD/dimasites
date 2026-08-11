<?php
define('DNEPR_SOURCE_GATEWAY', true);
require dirname(__FILE__) . '/source-common.php';

header('Content-Type: application/json; charset=UTF-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store, max-age=0');

function source_status($status)
{
    $messages = array(200 => 'OK', 400 => 'Bad Request', 403 => 'Forbidden', 405 => 'Method Not Allowed', 429 => 'Too Many Requests', 502 => 'Bad Gateway', 503 => 'Service Unavailable');
    header('HTTP/1.1 ' . $status . ' ' . (isset($messages[$status]) ? $messages[$status] : 'Error'));
}

function source_reply($status, $payload)
{
    source_status($status);
    echo json_encode($payload);
    exit;
}

function source_parse_attributes($tag)
{
    $attributes = array();
    if (preg_match_all('/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(["\x{27}])(.*?)\2/su', $tag, $matches, PREG_SET_ORDER)) {
        foreach ($matches as $match) { $attributes[strtolower($match[1])] = html_entity_decode($match[3], ENT_QUOTES, 'UTF-8'); }
    }
    return $attributes;
}

function source_parse_eis($html, $baseUrl)
{
    $results = array();
    $seen = array();
    $dom = dnepr_source_load_dom($html);
    if ($dom !== null) {
        $xpath = new DOMXPath($dom);
        $anchors = $xpath->query('//a[contains(@href,"regNumber=")]');
        if ($anchors !== false) {
            foreach ($anchors as $anchor) {
                if (count($results) >= 10) { break; }
                $href = $anchor->getAttribute('href');
                if (!preg_match('/[?&]regNumber=([0-9]+)/', $href, $numberMatch)) { continue; }
                $number = $numberMatch[1];
                if (isset($seen[$number])) { continue; }
                $url = dnepr_source_absolute_url($baseUrl, $href, array('zakupki.gov.ru', 'www.zakupki.gov.ru'));
                if ($url === null) { continue; }
                $seen[$number] = true;
                $block = $anchor;
                while ($block->parentNode && $block->parentNode instanceof DOMElement) {
                    $block = $block->parentNode;
                    $class = $block->getAttribute('class');
                    if (strpos($class, 'search-registry-entry-block') !== false || strpos($class, 'registry-entry') !== false) { break; }
                }
                $text = dnepr_source_normalize_text($block->textContent);
                $title = dnepr_source_normalize_text($anchor->textContent);
                $status = dnepr_source_xpath_text($xpath, './/*[contains(@class,"registry-entry__header-mid__title") or contains(@class,"registry-entry__header-top__title")]', $block);
                $customer = '';
                if (preg_match('/(?:Заказчик|Организация, осуществляющая размещение)\s*:?\s*(.{3,180}?)(?=\s{2,}|Размещено|Объект закупки|Начальная)/ui', $text, $customerMatch)) { $customer = trim($customerMatch[1]); }
                $published = '';
                if (preg_match('/(?:Размещено|Дата размещения)\s*:?\s*(\d{2}\.\d{2}\.\d{4})/u', $text, $dateMatch)) { $published = $dateMatch[1]; }
                $price = '';
                if (preg_match('/(?:Начальная[^:]{0,80}цена|Цена контракта)\s*:?\s*([0-9\s]+(?:[,.][0-9]{1,2})?\s*(?:₽|руб))/ui', $text, $priceMatch)) { $price = trim($priceMatch[1]); }
                $documentsUrl = preg_replace('/\/view\/[^?]+/', '/view/documents.html', $url);
                $results[] = array(
                    'id' => $number,
                    'title' => $title !== '' && strpos($title, $number) === false ? $title : 'Закупка № ' . $number,
                    'number' => $number,
                    'status' => $status,
                    'customer' => $customer,
                    'publishedAt' => $published,
                    'price' => $price,
                    'summary' => function_exists('mb_substr') ? mb_substr($text, 0, 900, 'UTF-8') : substr($text, 0, 900),
                    'url' => $url,
                    'documents' => array(array('label' => 'Документы закупки в ЕИС', 'url' => $documentsUrl, 'kind' => 'official-documents-page'))
                );
            }
        }
    }
    return $results;
}

function source_egrz_search_request($query, $cookieFile)
{
    $base = 'https://egrz.ru/organisation/reestr/latest';
    if (preg_match('/^\d{2}-\d-\d-\d-\d{6}-\d{4}$/', $query)) {
        return dnepr_source_http_get('https://egrz.ru/organisation/reestr/detail/' . rawurlencode($query), array('Accept: text/html,application/xhtml+xml', 'Accept-Language: ru-RU,ru;q=0.9', 'Referer: https://egrz.ru/organisation/reestr/latest'), $cookieFile);
    }
    $initial = dnepr_source_http_get($base, array('Accept: text/html,application/xhtml+xml', 'Accept-Language: ru-RU,ru;q=0.9'), $cookieFile);
    if (empty($initial['ok'])) { return $initial; }
    $form = '';
    if (preg_match_all('/<form\b[^>]*>.*?<\/form>/isu', $initial['body'], $forms)) {
        foreach ($forms[0] as $candidate) {
            if (stripos($candidate, 'Введите поисковый запрос') !== false || stripos($candidate, 'номер / дата заключения') !== false) { $form = $candidate; break; }
        }
    }
    if ($form === '') {
        $initial['ok'] = false;
        $initial['error'] = 'search_form_not_discoverable';
        $initial['errno'] = 0;
        return $initial;
    }
    preg_match('/<form\b[^>]*>/isu', $form, $formTagMatch);
    $formAttributes = source_parse_attributes(isset($formTagMatch[0]) ? $formTagMatch[0] : '');
    $inputName = '';
    $formFields = array();
    if (preg_match_all('/<input\b[^>]*>/isu', $form, $inputs)) {
        foreach ($inputs[0] as $inputTag) {
            $attributes = source_parse_attributes($inputTag);
            if (isset($attributes['name']) && $attributes['name'] !== '') {
                $inputType = isset($attributes['type']) ? strtolower($attributes['type']) : 'text';
                if ($inputType === 'hidden' || isset($attributes['value'])) {
                    $formFields[$attributes['name']] = isset($attributes['value']) ? $attributes['value'] : '';
                }
            }
            $placeholder = isset($attributes['placeholder']) ? $attributes['placeholder'] : '';
            if (stripos($placeholder, 'поисков') !== false || stripos($placeholder, 'заключения') !== false) {
                if (isset($attributes['name'])) { $inputName = $attributes['name']; }
                break;
            }
        }
    }
    if ($inputName === '') {
        $initial['ok'] = false;
        $initial['error'] = 'search_field_not_discoverable';
        $initial['errno'] = 0;
        return $initial;
    }
    $action = isset($formAttributes['action']) ? $formAttributes['action'] : $base;
    $target = dnepr_source_absolute_url($base, $action, array('egrz.ru', 'www.egrz.ru'));
    if ($target === null) { $target = $base; }
    $method = isset($formAttributes['method']) ? strtoupper($formAttributes['method']) : 'GET';
    $formFields[$inputName] = $query;
    $requestHeaders = array('Accept: text/html,application/xhtml+xml', 'Accept-Language: ru-RU,ru;q=0.9', 'Referer: ' . $base);
    if ($method === 'POST') {
        $requestHeaders[] = 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8';
        return dnepr_source_http_post($target, $requestHeaders, $cookieFile, $formFields);
    }
    $separator = strpos($target, '?') === false ? '?' : '&';
    $target .= $separator . http_build_query($formFields, '', '&');
    return dnepr_source_http_get($target, $requestHeaders, $cookieFile);
}

function source_parse_egrz($html, $baseUrl, $query)
{
    $results = array();
    $files = array();
    $seen = array();
    $dom = dnepr_source_load_dom($html);
    if ($dom !== null) {
        $xpath = new DOMXPath($dom);
        $anchors = $xpath->query('//a[@href]');
        if ($anchors !== false) {
            foreach ($anchors as $anchor) {
                $href = $anchor->getAttribute('href');
                if (preg_match('#/organisation/reestr/detail/([0-9-]+)#', $href, $match)) {
                    $number = $match[1];
                    if (isset($seen[$number]) || count($results) >= 10) { continue; }
                    $url = dnepr_source_absolute_url($baseUrl, $href, array('egrz.ru', 'www.egrz.ru'));
                    if ($url === null) { continue; }
                    $seen[$number] = true;
                    $row = $anchor;
                    while ($row->parentNode && $row->parentNode instanceof DOMElement && strtolower($row->nodeName) !== 'tr') { $row = $row->parentNode; }
                    $summary = dnepr_source_normalize_text($row->textContent);
                    $results[] = array('id' => $number, 'number' => $number, 'title' => 'Заключение № ' . $number, 'summary' => function_exists('mb_substr') ? mb_substr($summary, 0, 1200, 'UTF-8') : substr($summary, 0, 1200), 'url' => $url, 'documents' => array());
                }
                if (preg_match('/(?:xls|xlsx|xml|csv)(?:\?|$)/i', $href)) {
                    $fileUrl = dnepr_source_absolute_url($baseUrl, $href, array('egrz.ru', 'www.egrz.ru'));
                    if ($fileUrl !== null) { $files[$fileUrl] = array('label' => dnepr_source_normalize_text($anchor->textContent) ?: 'Выгрузка реестра ЕГРЗ', 'url' => $fileUrl, 'kind' => 'official-export'); }
                }
            }
        }
    }
    if (count($results) === 0 && preg_match('/^\d{2}-\d-\d-\d-\d{6}-\d{4}$/', $query)) {
        $text = dnepr_source_normalize_text($html);
        if ($text !== '' && stripos($text, 'страница не найдена') === false && stripos($text, 'Bad Gateway') === false) {
            $results[] = array('id' => $query, 'number' => $query, 'title' => 'Заключение № ' . $query, 'summary' => function_exists('mb_substr') ? mb_substr($text, 0, 1200, 'UTF-8') : substr($text, 0, 1200), 'url' => 'https://egrz.ru/organisation/reestr/detail/' . rawurlencode($query), 'documents' => array());
        }
    }
    return array('results' => $results, 'files' => array_values($files));
}

if (!isset($_SERVER['REQUEST_METHOD']) || $_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    source_reply(405, array('ok' => false, 'code' => 'method_not_allowed', 'message' => 'Используйте POST-запрос.'));
}
$origin = isset($_SERVER['HTTP_ORIGIN']) ? strtolower(trim($_SERVER['HTTP_ORIGIN'])) : '';
if ($origin !== '' && $origin !== 'https://stroydnepr.ru' && $origin !== 'https://www.stroydnepr.ru') {
    source_reply(403, array('ok' => false, 'code' => 'origin_denied', 'message' => 'Запрос разрешён только с сайта ДНЕПР.'));
}
$input = json_decode((string) file_get_contents('php://input'), true);
$source = is_array($input) && isset($input['source']) ? strtolower(trim((string) $input['source'])) : '';
$query = is_array($input) && isset($input['query']) ? dnepr_source_normalize_text($input['query']) : '';
$queryLength = function_exists('mb_strlen') ? mb_strlen($query, 'UTF-8') : strlen($query);
if (!in_array($source, array('egrz', 'eis'), true) || $queryLength < 3 || $queryLength > 240) {
    source_reply(400, array('ok' => false, 'code' => 'invalid_request', 'message' => 'Укажите источник и корректный запрос.'));
}
$remoteIp = isset($_SERVER['REMOTE_ADDR']) ? $_SERVER['REMOTE_ADDR'] : 'unknown';
if (!dnepr_source_rate_allowed($source, $remoteIp)) {
    source_reply(429, array('ok' => false, 'code' => 'rate_limited', 'message' => 'Слишком много проверок. Повторите через несколько минут.'));
}
$diagnosticId = dnepr_source_diagnostic_id($source);
$cookieFile = tempnam(sys_get_temp_dir(), 'dnepr-source-');
if ($cookieFile === false) { $cookieFile = ''; }

if ($source === 'eis') {
    $url = 'https://zakupki.gov.ru/epz/order/extendedsearch/results.html?searchString=' . rawurlencode($query)
        . '&morphology=on&pageNumber=1&sortDirection=false&recordsPerPage=_10&showLotsInfoHidden=false&sortBy=UPDATE_DATE'
        . '&fz44=on&fz223=on&af=on&ca=on&pc=on&pa=on&currencyIdGeneral=-1';
    $response = dnepr_source_http_get($url, array('Accept: text/html,application/xhtml+xml', 'Accept-Language: ru-RU,ru;q=0.9', 'Referer: https://zakupki.gov.ru/'), $cookieFile);
    $results = !empty($response['ok']) ? source_parse_eis($response['body'], $url) : array();
    $files = array();
} else {
    $response = source_egrz_search_request($query, $cookieFile);
    $parsed = !empty($response['ok']) ? source_parse_egrz($response['body'], isset($response['url']) && $response['url'] !== '' ? $response['url'] : 'https://egrz.ru/organisation/reestr/latest', $query) : array('results' => array(), 'files' => array());
    $results = $parsed['results'];
    $files = $parsed['files'];
}
if ($cookieFile !== '') { @unlink($cookieFile); }

if (empty($response['ok'])) {
    $code = isset($response['error']) && strpos($response['error'], 'discoverable') !== false ? 'integration_changed' : 'source_unavailable';
    $message = $code === 'integration_changed' ? 'Официальный реестр изменил поисковую форму. Автопроверка остановлена, чтобы не показывать недостоверные данные.' : dnepr_source_failure_message($response['errno'], $response['status']);
    dnepr_source_log($source, $query, 'unavailable', $diagnosticId, array('http_status' => $response['status'], 'latency_ms' => $response['latency_ms'], 'error_code' => $code, 'message' => $message));
    source_reply(502, array('ok' => false, 'code' => $code, 'message' => $message, 'diagnosticId' => $diagnosticId, 'technical' => array('httpStatus' => $response['status'], 'curlCode' => $response['errno'])));
}

$state = count($results) > 0 ? 'found' : 'missing';
dnepr_source_log($source, $query, $state, $diagnosticId, array('result_count' => count($results), 'http_status' => $response['status'], 'latency_ms' => $response['latency_ms'], 'results' => $results, 'files' => $files));
source_reply(200, array(
    'ok' => true,
    'found' => count($results) > 0,
    'query' => $query,
    'results' => $results,
    'files' => $files,
    'source' => array(
        'id' => $source,
        'name' => $source === 'eis' ? 'ЕИС в сфере закупок' : 'ГИС ЕГРЗ',
        'url' => $source === 'eis' ? 'https://zakupki.gov.ru/' : 'https://egrz.ru/',
        'retrievedAt' => gmdate('c'),
        'httpStatus' => $response['status'],
        'latencyMs' => $response['latency_ms']
    ),
    'diagnosticId' => $diagnosticId,
    'disclaimer' => 'Результат относится только к ответу официального источника на момент проверки. Отсутствие записи в ответе не доказывает отсутствие документа.'
));
