<?php
if (!defined('ABSPATH')) exit;

trait SENuke_AI_Menus_Forms {
    public static function create_menu(WP_REST_Request $request) {
        $data=$request->get_json_params(); $name=sanitize_text_field($data['name']??'SENuke Primary Navigation');
        $menu=wp_get_nav_menu_object($name); $menu_id=$menu?(int)$menu->term_id:wp_create_nav_menu($name); if(is_wp_error($menu_id))return $menu_id;
        foreach(wp_get_nav_menu_items($menu_id)?:[] as $existing)wp_delete_post($existing->ID,true);
        $created=[];$pending=array_values((array)($data['items']??[]));$position=1;
        for($pass=0;$pass<100&&$pending;$pass++){
            $remaining=[];
            foreach($pending as $item){if(!is_array($item))continue;$source=sanitize_key($item['id']??'');$parent=sanitize_key($item['parentId']??'');if($parent&&empty($created[$parent])){$remaining[]=$item;continue;}$new=wp_update_nav_menu_item($menu_id,0,['menu-item-title'=>sanitize_text_field($item['label']??'Page'),'menu-item-url'=>esc_url_raw($item['url']??home_url('/')),'menu-item-parent-id'=>$parent?(int)$created[$parent]:0,'menu-item-status'=>'publish','menu-item-position'=>$position++]);if(!is_wp_error($new)&&$source)$created[$source]=(int)$new;}
            if(count($remaining)===count($pending))break;$pending=$remaining;
        }
        $locations=get_theme_mod('nav_menu_locations',[]);$registered=get_registered_nav_menus();$requested=sanitize_key($data['location']??'');$preferred=($requested&&array_key_exists($requested,$registered))?$requested:null;
        if(!$preferred&&$requested==='footer')foreach(array_keys($registered) as $location)if(preg_match('/footer|bottom|secondary/i',$location)){$preferred=$location;break;}
        if(!$preferred&&$requested!=='footer')$preferred=array_key_exists('primary',$registered)?'primary':array_key_first($registered);
        if($preferred){$locations[$preferred]=$menu_id;set_theme_mod('nav_menu_locations',$locations);}return rest_ensure_response(['menuId'=>$menu_id,'location'=>$preferred,'itemCount'=>count($created)]);
    }

    public static function save_form(WP_REST_Request $request) {
        $data=$request->get_json_params();$key=sanitize_key($data['key']??'primary_contact');$forms=get_option(self::FORM_OPTION,[]);if(!is_array($forms))$forms=[];$fields=[];
        foreach((array)($data['fields']??[]) as $field){if(is_array($field)){$label=sanitize_text_field($field['label']??$field['name']??'Field');$name=sanitize_key($field['name']??$label);$type=sanitize_key($field['inputType']??$field['type']??'text');if(!in_array($type,['text','email','tel','textarea','checkbox'],true))$type='text';$fields[]=['label'=>$label,'name'=>$name,'inputType'=>$type,'required'=>!empty($field['required'])];}else{$label=sanitize_text_field($field);$fields[]=['label'=>$label,'name'=>sanitize_key($label),'inputType'=>preg_match('/message|details/i',$label)?'textarea':(stripos($label,'email')!==false?'email':'text'),'required'=>true];}}
        $forms[$key]=['name'=>sanitize_text_field($data['name']??'Contact form'),'fields'=>$fields,'submitLabel'=>sanitize_text_field($data['submitLabel']??'Submit'),'successMessage'=>sanitize_text_field($data['successMessage']??'Thank you. Your enquiry has been received.'),'destination'=>sanitize_email($data['destination']??get_option('admin_email'))];update_option(self::FORM_OPTION,$forms,false);return rest_ensure_response(['key'=>$key,'shortcode'=>'[senuke_form id="'.esc_attr($key).'"]']);
    }

    public static function form_shortcode($atts) {
        $id=sanitize_key(shortcode_atts(['id'=>'primary_contact'],$atts)['id']);$forms=get_option(self::FORM_OPTION,[]);$form=is_array($forms)?($forms[$id]??null):null;if(!$form)return'';ob_start(); ?>
        <form class="senuke-ai-form" method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>"><input type="hidden" name="action" value="senuke_form_submit"><input type="hidden" name="senuke_form_id" value="<?php echo esc_attr($id); ?>"><?php wp_nonce_field('senuke_form_'.$id,'senuke_nonce'); ?><?php if(($_GET['senuke_enquiry']??'')==='received'):?><p class="senuke-form-success" role="status"><?php echo esc_html($form['successMessage']);?></p><?php endif;?><?php foreach($form['fields'] as $field):$name=sanitize_key($field['name']??$field['label']);$type=$field['inputType']??'text';$required=!empty($field['required']);?><p><label><?php echo esc_html($field['label']);?><br><?php if($type==='textarea'):?><textarea name="<?php echo esc_attr($name);?>" <?php echo $required?'required':'';?>></textarea><?php elseif($type==='checkbox'):?><input name="<?php echo esc_attr($name);?>" type="checkbox" value="yes" <?php echo $required?'required':'';?>><?php else:?><input name="<?php echo esc_attr($name);?>" type="<?php echo esc_attr(in_array($type,['email','tel'],true)?$type:'text');?>" <?php echo $required?'required':'';?>><?php endif;?></label></p><?php endforeach;?><button type="submit"><?php echo esc_html($form['submitLabel']);?></button></form><?php return ob_get_clean();
    }

    public static function form_submit() {
        $id=sanitize_key($_POST['senuke_form_id']??'');if(!$id||!wp_verify_nonce($_POST['senuke_nonce']??'','senuke_form_'.$id))wp_die('Invalid form request.',403);$forms=get_option(self::FORM_OPTION,[]);$form=is_array($forms)?($forms[$id]??null):null;if(!$form)wp_die('Form unavailable.',404);$lines=[];foreach($form['fields'] as $field){$name=sanitize_key($field['name']??$field['label']);$lines[]=$field['label'].': '.sanitize_textarea_field(wp_unslash($_POST[$name]??''));}wp_mail($form['destination'],'Website enquiry: '.$form['name'],implode("\n",$lines));$return=wp_get_referer()?:home_url('/');wp_safe_redirect(add_query_arg('senuke_enquiry','received',$return));exit;
    }
}
