<?php
/**
 * Plugin Name: SENuke AI Connector
 * Description: Secure WordPress deployment bridge for SENuke AI website builds, ongoing posts and pages, SEO metadata, menus, and lead forms.
 * Version: 1.2.1
 * Author: SENuke AI
 */

if (!defined('ABSPATH')) exit;

final class SENuke_AI_Connector {
    const NS = 'senuke/v1';
    const FORM_OPTION = 'senuke_ai_forms';
    const STYLE_OPTION = 'senuke_ai_design_package';
    const BACKUP_OPTION = 'senuke_ai_deployment_backups';

    public static function boot() {
        add_action('rest_api_init', [__CLASS__, 'routes']);
        add_action('wp_head', [__CLASS__, 'head_meta'], 2);
        add_action('wp_enqueue_scripts', [__CLASS__, 'enqueue_design_package'], 30);
        add_filter('pre_get_document_title', [__CLASS__, 'document_title']);
        add_shortcode('senuke_form', [__CLASS__, 'form_shortcode']);
        add_action('admin_post_senuke_form_submit', [__CLASS__, 'form_submit']);
        add_action('admin_post_nopriv_senuke_form_submit', [__CLASS__, 'form_submit']);
    }

    public static function routes() {
        register_rest_route(self::NS, '/capabilities', [
            'methods' => 'GET', 'permission_callback' => fn() => current_user_can('edit_pages'),
            'callback' => fn() => rest_ensure_response([
                'connected' => true,
                'version' => '1.2.1',
                'features' => ['seo_meta', 'schema', 'menus', 'forms', 'site_backup', 'design_package', 'rollback'],
                'managedDeploymentReady' => current_user_can('publish_pages')
                    && current_user_can('upload_files')
                    && current_user_can('edit_theme_options')
                    && current_user_can('manage_options'),
                'permissions' => [
                    'publishPages' => current_user_can('publish_pages'),
                    'uploadMedia' => current_user_can('upload_files'),
                    'manageNavigationAndDesign' => current_user_can('edit_theme_options'),
                    'backupAndRollback' => current_user_can('manage_options'),
                ],
            ]),
        ]);
        register_rest_route(self::NS, '/pages/(?P<id>\d+)/optimize', [
            'methods' => 'POST', 'permission_callback' => fn($r) => current_user_can('edit_post', (int)$r['id']),
            'callback' => [__CLASS__, 'optimize_page'],
        ]);
        register_rest_route(self::NS, '/menus', [
            'methods' => 'POST', 'permission_callback' => fn() => current_user_can('edit_theme_options'),
            'callback' => [__CLASS__, 'create_menu'],
        ]);
        register_rest_route(self::NS, '/forms', [
            'methods' => 'POST', 'permission_callback' => fn() => current_user_can('edit_pages'),
            'callback' => [__CLASS__, 'save_form'],
        ]);
        register_rest_route(self::NS, '/backups', [
            'methods' => 'POST', 'permission_callback' => fn() => current_user_can('manage_options'),
            'callback' => [__CLASS__, 'create_backup'],
        ]);
        register_rest_route(self::NS, '/backups/(?P<id>[a-zA-Z0-9_-]+)/restore', [
            'methods' => 'POST', 'permission_callback' => fn() => current_user_can('manage_options'),
            'callback' => [__CLASS__, 'restore_backup'],
        ]);
        register_rest_route(self::NS, '/site-package', [
            'methods' => 'POST', 'permission_callback' => fn() => current_user_can('edit_theme_options'),
            'callback' => [__CLASS__, 'save_design_package'],
        ]);
    }

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
        ];
        foreach ($fields as $key => $value) update_post_meta($id, $key, $value);
        return rest_ensure_response(['updated' => true, 'postId' => $id]);
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
        wp_register_style('senuke-ai-approved-release', false, [], (string)($package['snapshotHash'] ?? '1.2.0'));
        wp_enqueue_style('senuke-ai-approved-release');
        wp_add_inline_style('senuke-ai-approved-release', $css);
    }

    public static function create_menu(WP_REST_Request $request) {
        $data = $request->get_json_params();
        $name = sanitize_text_field($data['name'] ?? 'SENuke Primary Navigation');
        $menu = wp_get_nav_menu_object($name);
        $menu_id = $menu ? (int)$menu->term_id : wp_create_nav_menu($name);
        if (is_wp_error($menu_id)) return $menu_id;
        foreach (wp_get_nav_menu_items($menu_id) ?: [] as $existing_item) wp_delete_post($existing_item->ID, true);
        $created = [];
        $pending = array_values((array)($data['items'] ?? []));
        $position = 1;
        for ($pass = 0; $pass < 20 && $pending; $pass++) {
            $remaining = [];
            foreach ($pending as $item) {
                $source_id = sanitize_key($item['id'] ?? '');
                $parent_id = sanitize_key($item['parentId'] ?? '');
                if ($parent_id && empty($created[$parent_id])) { $remaining[] = $item; continue; }
                $created_id = wp_update_nav_menu_item($menu_id, 0, [
                'menu-item-title' => sanitize_text_field($item['label'] ?? 'Page'),
                'menu-item-url' => esc_url_raw($item['url'] ?? home_url('/')),
                    'menu-item-parent-id' => $parent_id ? (int)$created[$parent_id] : 0,
                    'menu-item-status' => 'publish', 'menu-item-position' => $position++,
                ]);
                if (!is_wp_error($created_id) && $source_id) $created[$source_id] = (int)$created_id;
            }
            if (count($remaining) === count($pending)) break;
            $pending = $remaining;
        }
        $locations = get_theme_mod('nav_menu_locations', []);
        $registered = get_registered_nav_menus();
        $requested_location = sanitize_key($data['location'] ?? '');
        $preferred = ($requested_location && array_key_exists($requested_location, $registered)) ? $requested_location : null;
        if (!$preferred && $requested_location === 'footer') {
            foreach (array_keys($registered) as $registered_location) {
                if (preg_match('/footer|bottom|secondary/i', (string)$registered_location)) { $preferred = $registered_location; break; }
            }
        }
        if (!$preferred && $requested_location !== 'footer') $preferred = array_key_exists('primary', $registered) ? 'primary' : array_key_first($registered);
        if ($preferred) { $locations[$preferred] = $menu_id; set_theme_mod('nav_menu_locations', $locations); }
        return rest_ensure_response(['menuId' => $menu_id, 'location' => $preferred, 'itemCount' => count($created)]);
    }

    public static function save_form(WP_REST_Request $request) {
        $data = $request->get_json_params();
        $key = sanitize_key($data['key'] ?? 'primary_contact');
        $forms = get_option(self::FORM_OPTION, []);
        $fields = [];
        foreach ((array)($data['fields'] ?? []) as $field) {
            if (is_array($field)) {
                $label = sanitize_text_field($field['label'] ?? $field['name'] ?? 'Field');
                $name = sanitize_key($field['name'] ?? $label);
                $type = sanitize_key($field['inputType'] ?? $field['type'] ?? 'text');
                if (!in_array($type, ['text', 'email', 'tel', 'textarea', 'checkbox'], true)) $type = 'text';
                $fields[] = ['label' => $label, 'name' => $name, 'inputType' => $type, 'required' => !empty($field['required'])];
            } else {
                $label = sanitize_text_field($field);
                $fields[] = ['label' => $label, 'name' => sanitize_key($label), 'inputType' => preg_match('/message|details/i', $label) ? 'textarea' : (stripos($label, 'email') !== false ? 'email' : 'text'), 'required' => true];
            }
        }
        $forms[$key] = [
            'name' => sanitize_text_field($data['name'] ?? 'Contact form'),
            'fields' => $fields,
            'submitLabel' => sanitize_text_field($data['submitLabel'] ?? 'Submit'),
            'successMessage' => sanitize_text_field($data['successMessage'] ?? 'Thank you. Your enquiry has been received.'),
            'destination' => sanitize_email($data['destination'] ?? get_option('admin_email')),
        ];
        update_option(self::FORM_OPTION, $forms, false);
        return rest_ensure_response(['key' => $key, 'shortcode' => '[senuke_form id="' . esc_attr($key) . '"]']);
    }

    public static function form_shortcode($atts) {
        $id = sanitize_key(shortcode_atts(['id' => 'primary_contact'], $atts)['id']);
        $forms = get_option(self::FORM_OPTION, []); $form = $forms[$id] ?? null;
        if (!$form) return '';
        ob_start(); ?>
        <form class="senuke-ai-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="senuke_form_submit">
            <input type="hidden" name="senuke_form_id" value="<?php echo esc_attr($id); ?>">
            <?php wp_nonce_field('senuke_form_' . $id, 'senuke_nonce'); ?>
            <?php if (($_GET['senuke_enquiry'] ?? '') === 'received'): ?><p class="senuke-form-success" role="status"><?php echo esc_html($form['successMessage']); ?></p><?php endif; ?>
            <?php foreach ($form['fields'] as $field): $name = sanitize_key($field['name'] ?? $field['label']); $type = $field['inputType'] ?? 'text'; $required = !empty($field['required']); ?>
                <?php if ($type === 'checkbox'): ?>
                    <p><label><input name="<?php echo esc_attr($name); ?>" type="checkbox" value="yes" <?php echo $required ? 'required' : ''; ?>> <?php echo esc_html($field['label']); ?></label></p>
                <?php else: ?>
                    <p><label><?php echo esc_html($field['label']); ?><br><?php if ($type === 'textarea'): ?><textarea name="<?php echo esc_attr($name); ?>" <?php echo $required ? 'required' : ''; ?>></textarea><?php else: ?><input name="<?php echo esc_attr($name); ?>" type="<?php echo esc_attr(in_array($type, ['email', 'tel'], true) ? $type : 'text'); ?>" <?php echo $required ? 'required' : ''; ?>><?php endif; ?></label></p>
                <?php endif; ?>
            <?php endforeach; ?>
            <button type="submit"><?php echo esc_html($form['submitLabel']); ?></button>
        </form><?php return ob_get_clean();
    }

    public static function form_submit() {
        $id = sanitize_key($_POST['senuke_form_id'] ?? '');
        if (!$id || !wp_verify_nonce($_POST['senuke_nonce'] ?? '', 'senuke_form_' . $id)) wp_die('Invalid form request.', 403);
        $forms = get_option(self::FORM_OPTION, []); $form = $forms[$id] ?? null;
        if (!$form) wp_die('Form unavailable.', 404);
        $lines = []; foreach ($form['fields'] as $field) { $name = sanitize_key($field['name'] ?? $field['label']); $lines[] = $field['label'] . ': ' . sanitize_textarea_field(wp_unslash($_POST[$name] ?? '')); }
        wp_mail($form['destination'], 'Website enquiry: ' . $form['name'], implode("\n", $lines));
        $return_url = wp_get_referer() ?: home_url('/');
        wp_safe_redirect(add_query_arg('senuke_enquiry', 'received', $return_url)); exit;
    }

    public static function create_backup(WP_REST_Request $request) {
        $data = $request->get_json_params();
        $backup_id = sanitize_key('senuke-' . gmdate('Ymd-His') . '-' . wp_generate_password(6, false, false));
        $theme = wp_get_theme();
        $managed_menu = wp_get_nav_menu_object('SENuke Primary Navigation');
        $managed_menu_items = [];
        if ($managed_menu) {
            foreach (wp_get_nav_menu_items((int)$managed_menu->term_id) ?: [] as $item) {
                $managed_menu_items[] = [
                    'id' => (int)$item->ID,
                    'title' => (string)$item->title,
                    'url' => (string)$item->url,
                    'parent' => (int)$item->menu_item_parent,
                    'position' => (int)$item->menu_order,
                ];
            }
        }
        $seo_meta_keys = [
            '_senuke_meta_title',
            '_senuke_meta_description',
            '_senuke_canonical_url',
            '_senuke_schema_json',
            '_senuke_aeo_reviewed',
            '_senuke_geo_reviewed',
        ];
        $page_seo = [];
        foreach (get_posts(['post_type' => ['page', 'post'], 'post_status' => 'any', 'numberposts' => -1, 'fields' => 'ids']) as $page_id) {
            $saved = [];
            foreach ($seo_meta_keys as $meta_key) {
                $saved[$meta_key] = metadata_exists('post', $page_id, $meta_key)
                    ? get_post_meta($page_id, $meta_key, true)
                    : null;
            }
            $page_seo[(string)$page_id] = $saved;
        }
        $snapshot = [
            'backupId' => $backup_id,
            'createdAt' => gmdate('c'),
            'releaseId' => sanitize_text_field($data['releaseId'] ?? ''),
            'snapshotHash' => sanitize_text_field($data['snapshotHash'] ?? ''),
            'site' => [
                'blogname' => get_option('blogname'),
                'blogdescription' => get_option('blogdescription'),
                'show_on_front' => get_option('show_on_front'),
                'page_on_front' => (int)get_option('page_on_front'),
                'page_for_posts' => (int)get_option('page_for_posts'),
                'permalink_structure' => get_option('permalink_structure'),
            ],
            'theme' => ['stylesheet' => $theme->get_stylesheet(), 'template' => $theme->get_template(), 'version' => $theme->get('Version')],
            'activePlugins' => get_option('active_plugins', []),
            'navigationLocations' => get_theme_mod('nav_menu_locations', []),
            'managedMenu' => [
                'existed' => (bool)$managed_menu,
                'name' => 'SENuke Primary Navigation',
                'items' => $managed_menu_items,
            ],
            'pageSeo' => $page_seo,
            'designPackage' => get_option(self::STYLE_OPTION, []),
            'forms' => get_option(self::FORM_OPTION, []),
        ];
        $backups = get_option(self::BACKUP_OPTION, []);
        $backups[$backup_id] = $snapshot;
        if (count($backups) > 20) $backups = array_slice($backups, -20, null, true);
        update_option(self::BACKUP_OPTION, $backups, false);
        return rest_ensure_response([
            'backupId' => $backup_id,
            'createdAt' => $snapshot['createdAt'],
            'scope' => ['site_settings', 'theme_identity', 'active_plugins', 'navigation', 'page_seo', 'forms', 'design_package'],
        ]);
    }

    public static function restore_backup(WP_REST_Request $request) {
        $backup_id = sanitize_key($request['id']);
        $backups = get_option(self::BACKUP_OPTION, []);
        $snapshot = $backups[$backup_id] ?? null;
        if (!$snapshot) return new WP_Error('senuke_backup_not_found', 'The requested SENuke deployment backup was not found.', ['status' => 404]);
        foreach ((array)($snapshot['site'] ?? []) as $key => $value) update_option(sanitize_key($key), $value);
        set_theme_mod('nav_menu_locations', (array)($snapshot['navigationLocations'] ?? []));
        update_option(self::STYLE_OPTION, (array)($snapshot['designPackage'] ?? []), false);
        update_option(self::FORM_OPTION, (array)($snapshot['forms'] ?? []), false);
        $managed_menu_snapshot = (array)($snapshot['managedMenu'] ?? []);
        $managed_menu_name = sanitize_text_field($managed_menu_snapshot['name'] ?? 'SENuke Primary Navigation');
        $managed_menu = wp_get_nav_menu_object($managed_menu_name);
        if (empty($managed_menu_snapshot['existed'])) {
            if ($managed_menu) wp_delete_nav_menu((int)$managed_menu->term_id);
        } else {
            $managed_menu_id = $managed_menu ? (int)$managed_menu->term_id : wp_create_nav_menu($managed_menu_name);
            if (!is_wp_error($managed_menu_id)) {
                foreach (wp_get_nav_menu_items($managed_menu_id) ?: [] as $existing_item) wp_delete_post($existing_item->ID, true);
                $restored_items = [];
                $pending_items = array_values((array)($managed_menu_snapshot['items'] ?? []));
                for ($pass = 0; $pass < 20 && $pending_items; $pass++) {
                    $remaining_items = [];
                    foreach ($pending_items as $item) {
                        $old_id = (int)($item['id'] ?? 0);
                        $old_parent = (int)($item['parent'] ?? 0);
                        if ($old_parent && empty($restored_items[$old_parent])) { $remaining_items[] = $item; continue; }
                        $restored_id = wp_update_nav_menu_item($managed_menu_id, 0, [
                            'menu-item-title' => sanitize_text_field($item['title'] ?? 'Page'),
                            'menu-item-url' => esc_url_raw($item['url'] ?? home_url('/')),
                            'menu-item-parent-id' => $old_parent ? (int)$restored_items[$old_parent] : 0,
                            'menu-item-status' => 'publish',
                            'menu-item-position' => (int)($item['position'] ?? 0),
                        ]);
                        if (!is_wp_error($restored_id) && $old_id) $restored_items[$old_id] = (int)$restored_id;
                    }
                    if (count($remaining_items) === count($pending_items)) break;
                    $pending_items = $remaining_items;
                }
            }
        }
        $seo_meta_keys = [
            '_senuke_meta_title',
            '_senuke_meta_description',
            '_senuke_canonical_url',
            '_senuke_schema_json',
            '_senuke_aeo_reviewed',
            '_senuke_geo_reviewed',
        ];
        $saved_page_seo = (array)($snapshot['pageSeo'] ?? []);
        foreach ($saved_page_seo as $page_id => $saved_values) {
            $page_snapshot = (array)$saved_values;
            foreach ($seo_meta_keys as $meta_key) {
                if (array_key_exists($meta_key, $page_snapshot) && $page_snapshot[$meta_key] !== null) {
                    update_post_meta($page_id, $meta_key, $page_snapshot[$meta_key]);
                } else {
                    delete_post_meta($page_id, $meta_key);
                }
            }
        }
        flush_rewrite_rules(false);
        return rest_ensure_response([
            'restored' => true,
            'backupId' => $backup_id,
            'restoredAt' => gmdate('c'),
            'scope' => ['site_settings', 'navigation', 'page_seo', 'forms', 'design_package'],
        ]);
    }

    public static function save_design_package(WP_REST_Request $request) {
        $data = $request->get_json_params();
        $css = (string)($data['css'] ?? '');
        if (strlen($css) > 350000) return new WP_Error('senuke_css_too_large', 'The approved design package exceeds 350 KB.', ['status' => 413]);
        if (preg_match('/<|@import|javascript\s*:|expression\s*\(|behavior\s*:|-moz-binding/i', $css)) return new WP_Error('senuke_css_rejected', 'The design package contains an unsupported CSS construct.', ['status' => 400]);
        $package = [
            'releaseId' => sanitize_text_field($data['releaseId'] ?? ''),
            'snapshotHash' => sanitize_text_field($data['snapshotHash'] ?? ''),
            'css' => $css,
            'savedAt' => gmdate('c'),
        ];
        update_option(self::STYLE_OPTION, $package, false);
        return rest_ensure_response(['installed' => true, 'releaseId' => $package['releaseId'], 'snapshotHash' => $package['snapshotHash'], 'bytes' => strlen($css)]);
    }
}

SENuke_AI_Connector::boot();
