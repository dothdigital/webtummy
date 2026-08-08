<?php
if (!defined('ABSPATH')) exit;

trait SENuke_AI_Content_SEO {
    public static function optimize_page(WP_REST_Request $request) {
        $id = (int)$request['id'];
        $data = $request->get_json_params();
        $fields = [
            '_senuke_meta_title' => sanitize_text_field($data['metaTitle'] ?? ''),
            '_senuke_meta_description' => sanitize_textarea_field($data['metaDescription'] ?? ''),
            '_senuke_canonical_url' => esc_url_raw($data['canonicalUrl'] ?? ''),
            '_senuke_schema_json' => wp_json_encode($data['schemaJsonLd'] ?? new stdClass()),
            '_senuke_aeo_reviewed' => !empty($data['aeoReviewed']) ? '1' : '0',
            '_senuke_geo_reviewed' => !empty($data['geoReviewed']) ? '1' : '0',
            '_senuke_release_id' => sanitize_text_field($data['approvedReleaseId'] ?? ''),
            '_senuke_snapshot_hash' => sanitize_text_field($data['snapshotHash'] ?? ''),
            '_senuke_page_id' => sanitize_text_field($data['senukePageId'] ?? ''),
        ];
        foreach ($fields as $key => $value) update_post_meta($id, $key, $value);
        self::synchronize_identity_from_schema($data['schemaJsonLd'] ?? null, $data);
        return rest_ensure_response(['updated' => true, 'postId' => $id, 'theme' => self::theme_state()]);
    }

    public static function head_meta() {
        if (!is_singular()) return;
        $id = get_queried_object_id();
        $description = get_post_meta($id, '_senuke_meta_description', true);
        $canonical = get_post_meta($id, '_senuke_canonical_url', true);
        $schema = get_post_meta($id, '_senuke_schema_json', true);
        if ($description) echo '<meta name="description" content="' . esc_attr($description) . '">' . "\n";
        if ($canonical) echo '<link rel="canonical" href="' . esc_url($canonical) . '">' . "\n";
        if ($schema && json_decode($schema)) echo '<script type="application/ld+json">' . wp_json_encode(json_decode($schema)) . '</script>' . "\n";
    }

    public static function document_title($title) {
        if (!is_singular()) return $title;
        $saved = get_post_meta(get_queried_object_id(), '_senuke_meta_title', true);
        return $saved ?: $title;
    }

    public static function enqueue_design_package() {
        $package = get_option(self::STYLE_OPTION, []);
        $css = is_array($package) ? ($package['css'] ?? '') : '';
        if (!$css) return;
        wp_register_style('senuke-ai-approved-release', false, [], (string)($package['snapshotHash'] ?? self::VERSION));
        wp_enqueue_style('senuke-ai-approved-release');
        wp_add_inline_style('senuke-ai-approved-release', $css);
    }

    public static function save_site_identity(WP_REST_Request $request) {
        $data = $request->get_json_params();
        $logo = trim((string)($data['logoUrl'] ?? ''));
        if ($logo && !preg_match('/^https:\/\//i', $logo) && !preg_match('/^data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+\/=\s]+$/i', $logo)) {
            return new WP_Error('senuke_logo_rejected', 'The site logo must be an HTTPS image or approved inline image.', ['status' => 400]);
        }
        if (strlen($logo) > 2500000) return new WP_Error('senuke_logo_too_large', 'The site logo exceeds the supported size.', ['status' => 413]);
        $identity = self::sanitize_identity([
            'releaseId' => $data['releaseId'] ?? '',
            'snapshotHash' => $data['snapshotHash'] ?? '',
            'businessName' => $data['businessName'] ?? get_option('blogname'),
            'logoUrl' => $logo,
            'contactEmail' => $data['contactEmail'] ?? '',
            'contactPhone' => $data['contactPhone'] ?? '',
            'businessAddress' => $data['businessAddress'] ?? '',
            'copyrightText' => $data['copyrightText'] ?? '',
            'socialProfiles' => $data['socialProfiles'] ?? [],
        ]);
        update_option(self::IDENTITY_OPTION, $identity, false);
        if ($identity['businessName']) update_option('blogname', $identity['businessName']);
        return rest_ensure_response(['saved' => true, 'releaseId' => $identity['releaseId'], 'snapshotHash' => $identity['snapshotHash']]);
    }

    private static function sanitize_identity($data) {
        $profiles = [];
        foreach ((array)($data['socialProfiles'] ?? []) as $profile) {
            if (!is_array($profile)) continue;
            $url = esc_url_raw($profile['url'] ?? '');
            $network = sanitize_key($profile['network'] ?? '');
            if ($url && $network) $profiles[] = ['network' => $network, 'url' => $url];
        }
        return [
            'releaseId' => sanitize_text_field($data['releaseId'] ?? ''),
            'snapshotHash' => sanitize_text_field($data['snapshotHash'] ?? ''),
            'businessName' => sanitize_text_field($data['businessName'] ?? ''),
            'logoUrl' => (string)($data['logoUrl'] ?? ''),
            'contactEmail' => sanitize_email($data['contactEmail'] ?? ''),
            'contactPhone' => sanitize_text_field($data['contactPhone'] ?? ''),
            'businessAddress' => sanitize_text_field($data['businessAddress'] ?? ''),
            'copyrightText' => sanitize_text_field($data['copyrightText'] ?? ''),
            'socialProfiles' => array_values($profiles),
            'savedAt' => gmdate('c'),
        ];
    }

    private static function schema_items($schema) {
        if (is_string($schema)) $schema = json_decode($schema, true);
        if (!is_array($schema)) return [];
        if (isset($schema['@graph']) && is_array($schema['@graph'])) return $schema['@graph'];
        return [$schema];
    }

    private static function schema_has_type($item, $types) {
        if (!is_array($item)) return false;
        $value = $item['@type'] ?? '';
        $current = is_array($value) ? $value : [$value];
        return (bool)array_intersect(array_map('strval', $current), $types);
    }

    private static function address_text($address) {
        if (is_string($address)) return trim($address);
        if (!is_array($address)) return '';
        return implode(', ', array_filter(array_map('strval', [
            $address['streetAddress'] ?? '', $address['addressLocality'] ?? '', $address['addressRegion'] ?? '',
            $address['postalCode'] ?? '', $address['addressCountry'] ?? '',
        ])));
    }

    private static function synchronize_identity_from_schema($schema, $request_data = []) {
        $items = self::schema_items($schema);
        $organization = null;
        foreach ($items as $item) {
            if (self::schema_has_type($item, ['Organization', 'LocalBusiness', 'ProfessionalService', 'Corporation'])) { $organization = $item; break; }
        }
        if (!$organization) return;
        $existing = get_option(self::IDENTITY_OPTION, []);
        if (!is_array($existing)) $existing = [];
        $logo = $organization['logo'] ?? ($organization['image'] ?? '');
        if (is_array($logo)) $logo = $logo['url'] ?? ($logo['contentUrl'] ?? '');
        $same_as = array_values(array_filter(array_map('strval', (array)($organization['sameAs'] ?? []))));
        $profiles = [];
        foreach ($same_as as $url) {
            $host = wp_parse_url($url, PHP_URL_HOST);
            $network = $host ? sanitize_key(preg_replace('/^www\./', '', explode('.', $host)[0])) : 'social';
            $profiles[] = ['network' => $network ?: 'social', 'url' => $url];
        }
        $next = self::sanitize_identity([
            'releaseId' => $request_data['approvedReleaseId'] ?? ($existing['releaseId'] ?? ''),
            'snapshotHash' => $request_data['snapshotHash'] ?? ($existing['snapshotHash'] ?? ''),
            'businessName' => $organization['name'] ?? ($existing['businessName'] ?? get_option('blogname')),
            'logoUrl' => $logo ?: ($existing['logoUrl'] ?? ''),
            'contactEmail' => $organization['email'] ?? ($existing['contactEmail'] ?? ''),
            'contactPhone' => $organization['telephone'] ?? ($existing['contactPhone'] ?? ''),
            'businessAddress' => self::address_text($organization['address'] ?? '') ?: ($existing['businessAddress'] ?? ''),
            'copyrightText' => $existing['copyrightText'] ?? '',
            'socialProfiles' => $profiles ?: ($existing['socialProfiles'] ?? []),
        ]);
        update_option(self::IDENTITY_OPTION, $next, false);
        if ($next['businessName']) update_option('blogname', $next['businessName']);
    }
}
