#include <node_api.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <string.h>
#include <stdlib.h>
static napi_value rename_exclusive(napi_env env, napi_callback_info info) {
  napi_value args[2]; size_t argc=2, n; char *paths[2];
  napi_get_cb_info(env,info,&argc,args,NULL,NULL);
  if(argc!=2){napi_throw_type_error(env,NULL,"Two paths required");return NULL;}
  for(int i=0;i<2;i++){napi_get_value_string_utf8(env,args[i],NULL,0,&n);paths[i]=malloc(n+1);napi_get_value_string_utf8(env,args[i],paths[i],n+1,&n);}
  int rc=syscall(SYS_renameat2,AT_FDCWD,paths[0],AT_FDCWD,paths[1],1);int e=errno;
  free(paths[0]);free(paths[1]);
  if(rc){const char *code=e==EEXIST?"EEXIST":e==EACCES?"EACCES":e==ENOENT?"ENOENT":e==ENOSYS?"ENOSYS":"EIO";napi_value msg,error,c;napi_create_string_utf8(env,strerror(e),NAPI_AUTO_LENGTH,&msg);napi_create_error(env,NULL,msg,&error);napi_create_string_utf8(env,code,NAPI_AUTO_LENGTH,&c);napi_set_named_property(env,error,"code",c);napi_throw(env,error);return NULL;}
  napi_value result;napi_get_undefined(env,&result);return result;
}
static napi_value init(napi_env env,napi_value exports){napi_value fn;napi_create_function(env,NULL,0,rename_exclusive,NULL,&fn);napi_set_named_property(env,exports,"renameExclusive",fn);return exports;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
